/**
 * Configuration for the GitHub Action.
 */
export interface ActionConfiguration {
  /** The name of the step to execute. */
  stepName: string
  /** Additional flags for the step execution. */
  flags: string
  /** The version of Piper to use. */
  piperVersion: string
  /** The owner of the Piper repository. */
  piperOwner: string
  /** The name of the Piper repository. */
  piperRepo: string
  /** The version of SAP Piper to use. */
  sapPiperVersion: string
  /** The owner of the SAP Piper repository. */
  sapPiperOwner: string
  /** The name of the SAP Piper repository. */
  sapPiperRepo: string
  /** The GitHub server URL. */
  gitHubServer: string
  /** The GitHub API URL. */
  gitHubApi: string
  /** The GitHub token for authentication. */
  gitHubToken: string
  /** The GitHub Enterprise server URL. */
  gitHubEnterpriseServer: string
  /** The GitHub Enterprise API URL. */
  gitHubEnterpriseApi: string
  /** The GitHub Enterprise token for authentication. */
  gitHubEnterpriseToken: string
  /** The Docker image to use. */
  dockerImage: string
  /** Additional options for Docker. */
  dockerOptions: string
  /** Environment variables for Docker. */
  dockerEnvVars: string
  /** The sidecar Docker image to use. */
  sidecarImage: string
  /** Additional options for the sidecar container. */
  sidecarOptions: string
  /** Environment variables for the sidecar container. */
  sidecarEnvVars: string
  /** Whether to retrieve the default configuration. */
  retrieveDefaultConfig: boolean
  /** Custom paths for default configurations. */
  customDefaultsPaths: string
  /** Custom path for stage conditions. */
  customStageConditionsPath: string
  /** Whether to create maps for checking if a step is active. */
  createCheckIfStepActiveMaps: boolean
  /** Whether to export the pipeline environment. */
  exportPipelineEnvironment: boolean
}
