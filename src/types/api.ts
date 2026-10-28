/** Validation issue mapped to a form field. */
export interface ApiFieldIssue {
  field: string;
  message: string;
}

/** Error body returned by every management endpoint. */
export interface ApiErrorBody {
  success: false;
  error: string;
  issues?: ApiFieldIssue[];
}

/** Pagination envelope attached to every list response. */
export interface ListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/** Paginated list success body. */
export interface ListResponse<T> {
  success: true;
  data: T[];
  meta: ListMeta;
}

/** Single-record success body. */
export interface ItemResponse<T> {
  success: true;
  data: T;
}
