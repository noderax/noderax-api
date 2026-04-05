export const INCIDENT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
