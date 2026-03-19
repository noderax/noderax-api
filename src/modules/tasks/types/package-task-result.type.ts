import {
  PackageMutationTaskType,
  PackageReadTaskType,
  TASK_TYPES,
} from '../../../common/constants/task-types.constants';

export interface NormalizedPackageDto {
  name: string;
  version: string | null;
  architecture: string | null;
  description: string | null;
}

export interface NormalizedPackageSearchResultDto {
  name: string;
  version: string | null;
  description: string | null;
}

export interface NormalizedPackageListTaskResult {
  operation: typeof TASK_TYPES.PACKAGE_LIST;
  packages: NormalizedPackageDto[];
}

export interface NormalizedPackageSearchTaskResult {
  operation: typeof TASK_TYPES.PACKAGE_SEARCH;
  results: NormalizedPackageSearchResultDto[];
}

export interface NormalizedPackageMutationTaskResult {
  operation: PackageMutationTaskType;
  names: string[];
  purge: boolean;
  output: string | null;
}

export type NormalizedPackageReadTaskResult =
  | NormalizedPackageListTaskResult
  | NormalizedPackageSearchTaskResult;

export type NormalizedPackageTaskResult =
  | NormalizedPackageReadTaskResult
  | NormalizedPackageMutationTaskResult;

export function isPackageReadOperation(
  operation: PackageReadTaskType | string,
): operation is PackageReadTaskType {
  return (
    operation === TASK_TYPES.PACKAGE_LIST ||
    operation === TASK_TYPES.PACKAGE_SEARCH
  );
}
