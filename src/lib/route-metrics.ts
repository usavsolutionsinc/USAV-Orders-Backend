export function logRouteMetric(params: {
  route: string;
  method: string;
  startedAt: number;
  ok: boolean;
  details?: Record<string, unknown>;
}) {
  const payload = {
    event: 'route.metric',
    route: params.route,
    method: params.method,
    ok: params.ok,
    duration_ms: Date.now() - params.startedAt,
    ...(params.details || {}),
  };

  if (params.ok) {
    console.info(payload);
  } else {
    console.error(payload);
  }
}
