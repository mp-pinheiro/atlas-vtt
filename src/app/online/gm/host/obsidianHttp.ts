import { requestUrl } from 'obsidian';
import type { Http } from './http.ts';
export const obsidianHttp: Http = async (request) => {
  const response = await requestUrl({ url: request.url, method: request.method, headers: request.authorization === undefined ? {} : { Authorization: request.authorization }, ...(request.form === undefined ? {} : { body: new URLSearchParams(request.form).toString(), contentType: 'application/x-www-form-urlencoded' }), throw: false });
  let json: unknown = null;
  try { json = response.json; } catch { json = null; }
  return { status: response.status, json };
};
