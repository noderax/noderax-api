export type LogSourcePresetKind = 'file' | 'journal';

export type LogSourcePreset = {
  id: string;
  label: string;
  description: string;
  kind: LogSourcePresetKind;
  path?: string;
  unit?: string;
  identifier: string;
  requiresRoot: boolean;
  defaultBackfillLines: number;
};

export const LOG_SOURCE_PRESETS: LogSourcePreset[] = [
  {
    id: 'syslog',
    label: 'System log',
    description:
      'Reads recent lines from /var/log/syslog on Ubuntu-style distributions.',
    kind: 'file',
    path: '/var/log/syslog',
    identifier: '/var/log/syslog',
    requiresRoot: true,
    defaultBackfillLines: 200,
  },
  {
    id: 'auth.log',
    label: 'Authentication log',
    description:
      'Reads authentication and sudo activity from /var/log/auth.log.',
    kind: 'file',
    path: '/var/log/auth.log',
    identifier: '/var/log/auth.log',
    requiresRoot: true,
    defaultBackfillLines: 200,
  },
  {
    id: 'kern.log',
    label: 'Kernel log',
    description: 'Reads kernel messages from /var/log/kern.log.',
    kind: 'file',
    path: '/var/log/kern.log',
    identifier: '/var/log/kern.log',
    requiresRoot: true,
    defaultBackfillLines: 200,
  },
  {
    id: 'noderax-agent',
    label: 'Noderax agent journal',
    description: 'Reads the noderax-agent systemd journal unit in JSON mode.',
    kind: 'journal',
    unit: 'noderax-agent.service',
    identifier: 'noderax-agent.service',
    requiresRoot: true,
    defaultBackfillLines: 200,
  },
];

const LOG_SOURCE_PRESETS_BY_ID = new Map(
  LOG_SOURCE_PRESETS.map((preset) => [preset.id, preset] as const),
);

export function findLogSourcePresetOrThrow(id: string): LogSourcePreset {
  const preset = LOG_SOURCE_PRESETS_BY_ID.get(id);

  if (!preset) {
    throw new Error(`Unsupported log source preset: ${id}`);
  }

  return preset;
}
