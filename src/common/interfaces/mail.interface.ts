export interface Mail {
  to: string | string[];
  data: Record<string, any>;
  [key: string]: any;
}
