import { describe, expect, it } from "vitest";
import { cloudFormationExtractor, extractModel, kubernetesExtractor, type ArchitectureModel } from "../src/index.js";

// `@{` stands for `${`, so Fn::Sub strings don't look like JavaScript interpolation.
const template = (content: string, path = "template.yaml") => ({ path, content: content.replaceAll("@{", "${") });

const extract = (content: string, path?: string) => cloudFormationExtractor.extract(template(content, path));

/** Edges as `From → To`, by component name, so tests read like the diagram. */
const arrows = (model: ArchitectureModel) => {
  const names = new Map(model.nodes.map((node) => [node.id, node.name]));
  return model.edges.map((edge) => `${names.get(edge.from)} → ${names.get(edge.to)}`).sort();
};

const names = (model: ArchitectureModel) => model.nodes.map((node) => node.name).sort();

describe("cloudFormationExtractor: components", () => {
  it("draws data stores, queues, caches and compute, and records each resource type", () => {
    const model = extract(`
Resources:
  Orders: { Type: "AWS::DynamoDB::Table" }
  Uploads: { Type: "AWS::S3::Bucket" }
  Jobs: { Type: "AWS::SQS::Queue" }
  Sessions: { Type: "AWS::ElastiCache::ReplicationGroup" }
  Worker: { Type: "AWS::Lambda::Function" }
`);

    const byName = Object.fromEntries(model.nodes.map((node) => [node.name, node]));
    expect(byName["Orders"]).toMatchObject({ kind: "database", type: "AWS::DynamoDB::Table" });
    expect(byName["Uploads"]).toMatchObject({ kind: "database", type: "AWS::S3::Bucket" });
    expect(byName["Jobs"]).toMatchObject({ kind: "queue", type: "AWS::SQS::Queue" });
    expect(byName["Sessions"]).toMatchObject({ kind: "cache" });
    expect(byName["Worker"]).toMatchObject({ kind: "service", type: "AWS::Lambda::Function" });
  });

  it("draws a classic load balancer and an auto scaling group, and links the balancer to its servers", () => {
    const model = extract(`
Resources:
  Web: { Type: "AWS::EC2::Instance" }
  Pool: { Type: "AWS::AutoScaling::AutoScalingGroup" }
  Balancer:
    Type: AWS::ElasticLoadBalancing::LoadBalancer
    Properties: { Instances: [!Ref Web] }
`);

    expect(names(model)).toEqual(["Balancer", "Pool", "Web"]);
    expect(model.nodes.every((node) => node.kind === "service")).toBe(true);
    expect(arrows(model)).toEqual(["Balancer → Web"]);
  });

  it("leaves out configuration that is not a component", () => {
    const model = extract(`
Resources:
  Role: { Type: "AWS::IAM::Role" }
  Logs: { Type: "AWS::Logs::LogGroup" }
  Stage: { Type: "AWS::ApiGateway::Stage" }
  Fn: { Type: "AWS::Lambda::Function" }
`);
    expect(names(model)).toEqual(["Fn"]);
  });

  it("scopes ids to the file, since two templates commonly reuse a logical id", () => {
    const one = extract('Resources:\n  Fn: { Type: "AWS::Lambda::Function" }\n', "a/template.yaml");
    const two = extract('Resources:\n  Fn: { Type: "AWS::Lambda::Function" }\n', "b/template.yaml");

    expect(one.nodes[0]?.id).toBe("a/template.yaml#Fn");
    expect(new Set([...one.nodes, ...two.nodes].map((node) => node.id)).size).toBe(2);
    expect(one.nodes[0]?.name).toBe("Fn");
  });
});

describe("cloudFormationExtractor: references", () => {
  it("follows Ref, GetAtt (short and list form) and Sub in YAML short form", () => {
    const model = extract(`
Resources:
  Table: { Type: "AWS::DynamoDB::Table" }
  Queue: { Type: "AWS::SQS::Queue" }
  Topic: { Type: "AWS::SNS::Topic" }
  Bucket: { Type: "AWS::S3::Bucket" }
  Fn:
    Type: AWS::Lambda::Function
    Properties:
      Environment:
        Variables:
          A: !Ref Table
          B: !GetAtt Queue.Arn
          C: !GetAtt [Topic, TopicName]
          D: !Sub "arn:aws:s3:::@{Bucket}/*"
`);
    expect(arrows(model)).toEqual(["Fn → Bucket", "Fn → Queue", "Fn → Table", "Fn → Topic"]);
  });

  it("reads references nested inside other functions and conditions", () => {
    const model = extract(`
Resources:
  Table: { Type: "AWS::DynamoDB::Table" }
  Queue: { Type: "AWS::SQS::Queue" }
  Fn:
    Type: AWS::Lambda::Function
    Properties:
      Environment:
        Variables:
          A: !Join ["-", ["x", !Ref Table]]
          B: !If [UseQueue, !GetAtt Queue.Arn, !Ref "AWS::NoValue"]
          C: !Select [0, [!Ref Table]]
          D: !FindInMap [Map, Key, Value]
`);
    expect(arrows(model)).toEqual(["Fn → Queue", "Fn → Table"]);
  });

  it("ignores parameters, pseudo parameters and escaped literals inside Sub", () => {
    const model = extract(`
Parameters:
  Stage: { Type: String }
Resources:
  Table: { Type: "AWS::DynamoDB::Table" }
  Fn:
    Type: AWS::Lambda::Function
    Properties:
      Environment:
        Variables:
          A: !Sub "@{AWS::Region}-@{Stage}-@{!NotAResource}"
          B: !Ref Stage
`);
    expect(arrows(model)).toEqual([]);
  });

  it("reads Sub with a variable map, and the references inside the map", () => {
    const model = extract(`
Resources:
  Table: { Type: "AWS::DynamoDB::Table" }
  Fn:
    Type: AWS::Lambda::Function
    Properties:
      Environment:
        Variables:
          A: !Sub ["@{Name}-suffix", { Name: !Ref Table }]
`);
    expect(arrows(model)).toEqual(["Fn → Table"]);
  });

  it("reads DependsOn, as a name or a list", () => {
    const model = extract(`
Resources:
  Table: { Type: "AWS::DynamoDB::Table" }
  Queue: { Type: "AWS::SQS::Queue" }
  One: { Type: "AWS::Lambda::Function", DependsOn: Table }
  Two: { Type: "AWS::Lambda::Function", DependsOn: [Table, Queue] }
`);
    expect(arrows(model)).toEqual(["One → Table", "Two → Queue", "Two → Table"]);
  });

  it("reads a JSON template, where functions are already in long form", () => {
    const model = extract(
      JSON.stringify({
        Resources: {
          Table: { Type: "AWS::DynamoDB::Table" },
          Queue: { Type: "AWS::SQS::Queue" },
          Topic: { Type: "AWS::SNS::Topic" },
          Fn: {
            Type: "AWS::Lambda::Function",
            Properties: {
              Environment: {
                Variables: {
                  A: { Ref: "Table" },
                  B: { "Fn::GetAtt": ["Queue", "Arn"] },
                  C: { "Fn::Sub": "arn:@{Topic}" },
                },
              },
            },
          },
        },
      }),
      "stack.json",
    );
    expect(arrows(model)).toEqual(["Fn → Queue", "Fn → Table", "Fn → Topic"]);
  });

  it("looks through resources that are not components, such as an IAM role", () => {
    const model = extract(`
Resources:
  Table: { Type: "AWS::DynamoDB::Table" }
  Role:
    Type: AWS::IAM::Role
    Properties:
      Policies:
        - PolicyDocument:
            Statement:
              - Resource: !GetAtt Table.Arn
  Fn:
    Type: AWS::Lambda::Function
    Properties:
      Role: !GetAtt Role.Arn
`);
    expect(arrows(model)).toEqual(["Fn → Table"]);
  });

  it("never links a component to itself and survives reference cycles", () => {
    const model = extract(`
Resources:
  Table: { Type: "AWS::DynamoDB::Table" }
  Role:
    Type: AWS::IAM::Role
    Properties:
      Anything: !Ref Fn
      Other: !Ref Table
  Fn:
    Type: AWS::Lambda::Function
    Properties:
      Role: !Ref Role
      Self: !Ref Fn
`);
    expect(arrows(model)).toEqual(["Fn → Table"]);
  });
});

describe("cloudFormationExtractor: direction", () => {
  it("points from the API or queue that triggers a SAM function to the function", () => {
    const model = extract(`
Transform: AWS::Serverless-2016-10-31
Resources:
  Api: { Type: "AWS::Serverless::Api", Properties: { StageName: prod } }
  Queue: { Type: "AWS::SQS::Queue" }
  Table: { Type: "AWS::DynamoDB::Table" }
  Fn:
    Type: AWS::Serverless::Function
    Properties:
      Environment: { Variables: { T: !Ref Table } }
      Events:
        Http:
          Type: Api
          Properties: { RestApiId: !Ref Api, Path: /x, Method: get }
        Jobs:
          Type: SQS
          Properties: { Queue: !GetAtt Queue.Arn }
`);
    expect(arrows(model)).toEqual(["Api → Fn", "Fn → Table", "Queue → Fn"]);
  });

  it("adds the API SAM creates for a function whose Api event names none", () => {
    const model = extract(`
Transform: AWS::Serverless-2016-10-31
Resources:
  Fn:
    Type: AWS::Serverless::Function
    Properties:
      Events:
        Http: { Type: Api, Properties: { Path: /x, Method: get } }
        Fast: { Type: HttpApi, Properties: { Path: /y, Method: get } }
`);
    expect(names(model)).toEqual(["Fn", "ServerlessHttpApi", "ServerlessRestApi"]);
    expect(arrows(model)).toEqual(["ServerlessHttpApi → Fn", "ServerlessRestApi → Fn"]);
    expect(model.nodes.find((node) => node.name === "ServerlessRestApi")?.type).toBe("AWS::Serverless::Api");
  });

  it("does not add the implicit API when the event names one", () => {
    const model = extract(`
Resources:
  Api: { Type: "AWS::Serverless::Api" }
  Fn:
    Type: AWS::Serverless::Function
    Properties:
      Events:
        Http: { Type: Api, Properties: { RestApiId: !Ref Api, Path: /x, Method: get } }
`);
    expect(names(model)).toEqual(["Api", "Fn"]);
  });

  it("reads Lambda permissions and event source mappings as the caller reaching the function", () => {
    const model = extract(`
Resources:
  Api: { Type: "AWS::ApiGateway::RestApi" }
  Queue: { Type: "AWS::SQS::Queue" }
  ApiFn: { Type: "AWS::Lambda::Function" }
  QueueFn: { Type: "AWS::Lambda::Function" }
  Permission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref ApiFn
      SourceArn: !Sub "arn:aws:execute-api:*:*:@{Api}/*"
  Mapping:
    Type: AWS::Lambda::EventSourceMapping
    Properties:
      FunctionName: !Ref QueueFn
      EventSourceArn: !GetAtt Queue.Arn
`);
    expect(arrows(model)).toEqual(["Api → ApiFn", "Queue → QueueFn"]);
  });

  it("reads API Gateway methods, HTTP API integrations, SNS subscriptions and AppSync data sources", () => {
    const model = extract(`
Resources:
  RestApi: { Type: "AWS::ApiGateway::RestApi" }
  HttpApi: { Type: "AWS::ApiGatewayV2::Api" }
  GraphQl: { Type: "AWS::AppSync::GraphQLApi" }
  Topic: { Type: "AWS::SNS::Topic" }
  Table: { Type: "AWS::DynamoDB::Table" }
  RestFn: { Type: "AWS::Lambda::Function" }
  HttpFn: { Type: "AWS::Lambda::Function" }
  TopicFn: { Type: "AWS::Lambda::Function" }
  Method:
    Type: AWS::ApiGateway::Method
    Properties:
      RestApiId: !Ref RestApi
      Integration:
        Uri: !Sub "arn:aws:apigateway:x:lambda:path/functions/@{RestFn.Arn}/invocations"
  Integration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref HttpApi
      IntegrationUri: !GetAtt HttpFn.Arn
  Subscription:
    Type: AWS::SNS::Subscription
    Properties:
      TopicArn: !Ref Topic
      Endpoint: !GetAtt TopicFn.Arn
  DataSource:
    Type: AWS::AppSync::DataSource
    Properties:
      ApiId: !GetAtt GraphQl.ApiId
      DynamoDBConfig: { TableName: !Ref Table }
`);
    expect(arrows(model)).toEqual([
      "GraphQl → Table",
      "HttpApi → HttpFn",
      "RestApi → RestFn",
      "Topic → TopicFn",
    ]);
  });

  it("points an EventBridge rule at its targets", () => {
    const model = extract(`
Resources:
  Rule:
    Type: AWS::Events::Rule
    Properties:
      Targets:
        - Arn: !GetAtt Fn.Arn
          Id: target
  Fn: { Type: "AWS::Lambda::Function" }
`);
    expect(arrows(model)).toEqual(["Rule → Fn"]);
  });
});

describe("cloudFormationExtractor: what it does not read", () => {
  it.each([
    ["YAML that is not a template", "name: CI\non: push\njobs: {}\n", "ci.yml"],
    ["a template-shaped file without resources", "Description: AWS::Nothing here\nParameters: {}\n", "t.yaml"],
    ["JSON that does not parse", '{ "note": "AWS::Lambda::Function", }', "tsconfig.json"],
    ["JSON that is not a template", '{ "name": "pkg", "note": "AWS::Thing" }', "package.json"],
    ["a Kubernetes manifest", "apiVersion: v1\nkind: Pod\nmetadata: { name: x }\n", "pod.yaml"],
  ])("returns an empty model for %s", (_label, content, path) => {
    expect(extract(content, path)).toEqual({ nodes: [], edges: [] });
  });

  it("does not try to parse a YAML file that never mentions an AWS resource type", () => {
    // Every JSON and YAML file in a repository is offered to this extractor, so a broken one that
    // has nothing to do with CloudFormation must not fail the whole run here.
    const broken = "key: [unclosed\n";
    expect(() => extract(broken, "unrelated.yaml")).not.toThrow();
    expect(extract(broken, "unrelated.yaml")).toEqual({ nodes: [], edges: [] });
  });

  it("names the file when a YAML template is malformed", () => {
    expect(() => extract('Resources:\n  X: [ "AWS::Lambda::Function"\n', "bad/template.yaml")).toThrow(
      /Invalid YAML in bad\/template\.yaml/,
    );
  });

  it.each(["template.yaml", "stack.yml", "infra/stack.json", "app.template"])("is offered %s", (path) => {
    expect(cloudFormationExtractor.matches(path)).toBe(true);
  });

  it.each([
    "README.md",
    "src/index.ts",
    "amplify/backend/function/fn/fn-cloudformation-template.json",
    "app/amplify/backend/api/x/cloudformation-template.json",
  ])("is not offered %s", (path) => {
    expect(cloudFormationExtractor.matches(path)).toBe(false);
  });
});

describe("extractModel with CloudFormation templates", () => {
  it("lets Kubernetes and CloudFormation share YAML files without reading each other's", () => {
    const model = extractModel([
      template("Resources:\n  Fn: { Type: \"AWS::Lambda::Function\" }\n", "aws/template.yaml"),
      template("apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: web }\nspec:\n  template:\n    spec:\n      containers: [{ image: nginx }]\n", "k8s/web.yaml"),
    ]);

    expect(model.nodes.map((node) => node.name).sort()).toEqual(["Fn", "web"]);
  });

  it("does not let the Kubernetes extractor choke on short-form tags", () => {
    expect(() => kubernetesExtractor.extract(template("Resources:\n  A:\n    Type: AWS::X::Y\n    Properties: { V: !Ref B }\n"))).not.toThrow();
  });
});
