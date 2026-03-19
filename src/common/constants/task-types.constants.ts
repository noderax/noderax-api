export const TASK_TYPES = {
  PACKAGE_LIST: 'packageList',
  PACKAGE_SEARCH: 'packageSearch',
  PACKAGE_INSTALL: 'packageInstall',
  PACKAGE_REMOVE: 'packageRemove',
  PACKAGE_PURGE: 'packagePurge',
} as const;

export const PACKAGE_READ_TASK_TYPES = [
  TASK_TYPES.PACKAGE_LIST,
  TASK_TYPES.PACKAGE_SEARCH,
] as const;

export const PACKAGE_MUTATION_TASK_TYPES = [
  TASK_TYPES.PACKAGE_INSTALL,
  TASK_TYPES.PACKAGE_REMOVE,
  TASK_TYPES.PACKAGE_PURGE,
] as const;

export const PACKAGE_TASK_TYPES = [
  ...PACKAGE_READ_TASK_TYPES,
  ...PACKAGE_MUTATION_TASK_TYPES,
] as const;

export type PackageReadTaskType = (typeof PACKAGE_READ_TASK_TYPES)[number];
export type PackageMutationTaskType =
  (typeof PACKAGE_MUTATION_TASK_TYPES)[number];
export type PackageTaskType = (typeof PACKAGE_TASK_TYPES)[number];

export function isPackageTaskType(value: string): value is PackageTaskType {
  return (PACKAGE_TASK_TYPES as readonly string[]).includes(value);
}
