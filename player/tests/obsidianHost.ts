export { App, Component, FileView, ItemView, Keymap, MarkdownRenderChild, MarkdownRenderer, MarkdownView, Notice, Plugin, Scope, TAbstractFile, TFile, TFolder, View, WorkspaceLeaf, base64ToArrayBuffer, getLanguage, normalizePath, resolveSubpath } from '../../tests/mocks/obsidian.ts';
export { Platform, apiVersion, requireApiVersion, parseYaml, stringifyYaml, setIcon, displayTooltip, getFrontMatterInfo, parseFrontMatterAliases, prepareFuzzySearch, Modal, Menu, Setting, SuggestModal, FuzzySuggestModal } from '../../tests/mocks/obsidian.ts';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';

export async function requestUrl(input: string | RequestUrlParam): Promise<RequestUrlResponse> {
  const options = typeof input === 'string' ? { url: input } : input;
  const url = new URL(options.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error(`The local acceptance host refuses external HTTP: ${url.origin}`);
  const response = await fetch(url, { method: options.method, headers: options.headers, body: options.body });
  if (!response.ok && options.throw !== false) throw new Error(`Local HTTP ${response.status}: ${url.pathname}`);
  const arrayBuffer = await response.arrayBuffer();
  const text = new TextDecoder().decode(arrayBuffer);
  return { status: response.status, headers: Object.fromEntries(response.headers), arrayBuffer, text, json: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
}
