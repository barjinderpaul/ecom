export function createHealthService({ checks }) {
  return {
    async check() {
      const names = Object.keys(checks);
      const results = await Promise.allSettled(names.map((name) => checks[name]()));
      const report = {};
      let healthy = true;
      names.forEach((name, i) => {
        const up = results[i].status === 'fulfilled';
        healthy &&= up;
        report[name] = up ? 'up' : 'down';
      });
      return { status: healthy ? 'ok' : 'degraded', checks: report };
    },
  };
}
