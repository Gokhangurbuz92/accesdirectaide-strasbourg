
/**
* Connector observability metrics.
* Records deterministic metrics for each sync run.
* @param {{ sourceId: any; id: any; completedAt: number; startedAt: number; state: any; stats: { fetched: any; validated: any; created: any; updated: any; unchanged: any; removed: any; rejected: any; conflicting: any; errors: any; }; }} syncRun
*/
export function createMetricsRecord(syncRun) {
  return {
    sourceId: syncRun.sourceId,
    syncRunId: syncRun.id,
    syncDuration: syncRun.completedAt ? syncRun.completedAt - syncRun.startedAt : null,
    fetchStatus: syncRun.state,
    recordsFetched: syncRun.stats.fetched,
    recordsValidated: syncRun.stats.validated,
    recordsCreated: syncRun.stats.created || 0,
    recordsUpdated: syncRun.stats.updated || 0,
    recordsUnchanged: syncRun.stats.unchanged || 0,
    recordsRemoved: syncRun.stats.removed || 0,
    recordsRejected: syncRun.stats.rejected,
    recordsConflicting: syncRun.stats.conflicting || 0,
    errors: syncRun.stats.errors,
    timestamp: new Date()
  };
}

/**
* @param {{ errors: string | any[]; }} metrics
*/
export function logMetrics(metrics) {
  // Structured logging — no raw personal data
  console.log(JSON.stringify({
    type: 'CONNECTOR_METRICS',
    ...metrics,
    errors: metrics.errors.length // Only count, not full error messages in default log
  }));
}
