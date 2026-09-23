/**
 * Broad category of a component. It only drives how the component is drawn,
 * so extractors should classify by best effort rather than exactness. The four built-in
 * kinds are always drawn; any other name is a custom kind defined in the config file.
 */
export type NodeKind = "service" | "database" | "cache" | "queue" | (string & {});

/** A component of the system, such as a service, a database or a message queue. */
export interface ArchNode {
  /**
   * Identifier that is unique within a model. Diffs match components across
   * two models by this value, so it must stay stable between revisions.
   */
  id: string;
  /** Human-readable label shown in diagrams. */
  name: string;
  kind: NodeKind;
  /** Path of the file the component was extracted from, relative to the scanned root. */
  source: string;
  /** Container image reference, when the component is defined by one. */
  image?: string;
  /**
   * What the component is in the source format's own terms, when that says more than
   * `kind` does: a CloudFormation resource type such as `AWS::Lambda::Function`, or an
   * Amplify service such as `DynamoDB`.
   */
  type?: string;
}

/** A dependency between two components. */
export interface ArchEdge {
  /** Id of the component that depends on `to`. */
  from: string;
  /** Id of the component being depended upon. */
  to: string;
  /** How the source file declares the relationship, for example `depends_on`. */
  label?: string;
}

/** Snapshot of a system's structure, independent of the format it was extracted from. */
export interface ArchitectureModel {
  nodes: ArchNode[];
  edges: ArchEdge[];
}
