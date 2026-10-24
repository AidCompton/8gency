// API versions that providers retire on a schedule. Override from the
// environment when a version is sunset, without a code change.
export const GRAPH = process.env.META_GRAPH_VERSION ?? "v23.0";
export const GOOGLE_ADS = process.env.GOOGLE_ADS_API_VERSION ?? "v22";
