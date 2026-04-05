export const LOG_MONITOR_CADENCES = ['minutely', 'custom'] as const;

export type LogMonitorCadence = (typeof LOG_MONITOR_CADENCES)[number];
