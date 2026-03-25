export interface FilterResponse<T> {
  items: T[];
  count: number;
  pages: number;
  previousPage: number | null;
  page: number;
  nextPage: number | null;
  limit: number;
}
