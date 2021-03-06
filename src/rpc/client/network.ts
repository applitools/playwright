/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { URLSearchParams } from 'url';
import { RequestChannel, ResponseChannel, RouteChannel, RequestInitializer, ResponseInitializer, RouteInitializer } from '../channels';
import { ChannelOwner } from './channelOwner';
import { Frame } from './frame';
import { normalizeFulfillParameters, headersArrayToObject, normalizeContinueOverrides } from '../../converters';
import { Headers } from './types';

export type NetworkCookie = {
  name: string,
  value: string,
  domain: string,
  path: string,
  expires: number,
  httpOnly: boolean,
  secure: boolean,
  sameSite: 'Strict' | 'Lax' | 'None'
};

export type SetNetworkCookieParam = {
  name: string,
  value: string,
  url?: string,
  domain?: string,
  path?: string,
  expires?: number,
  httpOnly?: boolean,
  secure?: boolean,
  sameSite?: 'Strict' | 'Lax' | 'None'
};

type FulfillResponse = {
  status?: number,
  headers?: Headers,
  contentType?: string,
  body?: string | Buffer,
};

type ContinueOverrides = {
  method?: string,
  headers?: Headers,
  postData?: string | Buffer,
};

export class Request extends ChannelOwner<RequestChannel, RequestInitializer> {
  private _redirectedFrom: Request | null = null;
  private _redirectedTo: Request | null = null;
  _failureText: string | null = null;
  private _headers: Headers;
  private _postData: Buffer | null;

  static from(request: RequestChannel): Request {
    return (request as any)._object;
  }

  static fromNullable(request: RequestChannel | undefined): Request | null {
    return request ? Request.from(request) : null;
  }

  constructor(parent: ChannelOwner, type: string, guid: string, initializer: RequestInitializer) {
    super(parent, type, guid, initializer);
    this._redirectedFrom = Request.fromNullable(initializer.redirectedFrom);
    if (this._redirectedFrom)
      this._redirectedFrom._redirectedTo = this;
    this._headers = headersArrayToObject(initializer.headers);
    this._postData = initializer.postData ? Buffer.from(initializer.postData, 'base64') : null;
  }

  url(): string {
    return this._initializer.url;
  }

  resourceType(): string {
    return this._initializer.resourceType;
  }

  method(): string {
    return this._initializer.method;
  }

  postData(): string | null {
    return this._postData ? this._postData.toString('utf8') : null;
  }

  postDataBuffer(): Buffer | null {
    return this._postData;
  }

  postDataJSON(): Object | null {
    const postData = this.postData();
    if (!postData)
      return null;

    const contentType = this.headers()['content-type'];
    if (!contentType)
      return null;

    if (contentType === 'application/x-www-form-urlencoded') {
      const entries: Record<string, string> = {};
      const parsed = new URLSearchParams(postData);
      for (const [k, v] of parsed.entries())
        entries[k] = v;
      return entries;
    }

    return JSON.parse(postData);
  }

  headers(): Headers {
    return { ...this._headers };
  }

  async response(): Promise<Response | null> {
    return Response.fromNullable((await this._channel.response()).response);
  }

  frame(): Frame {
    return Frame.from(this._initializer.frame);
  }

  isNavigationRequest(): boolean {
    return this._initializer.isNavigationRequest;
  }

  redirectedFrom(): Request | null {
    return this._redirectedFrom;
  }

  redirectedTo(): Request | null {
    return this._redirectedTo;
  }

  failure(): { errorText: string; } | null {
    if (this._failureText === null)
      return null;
    return {
      errorText: this._failureText
    };
  }

  _finalRequest(): Request {
    return this._redirectedTo ? this._redirectedTo._finalRequest() : this;
  }
}

export class Route extends ChannelOwner<RouteChannel, RouteInitializer> {
  static from(route: RouteChannel): Route {
    return (route as any)._object;
  }

  constructor(parent: ChannelOwner, type: string, guid: string, initializer: RouteInitializer) {
    super(parent, type, guid, initializer);
  }

  request(): Request {
    return Request.from(this._initializer.request);
  }

  async abort(errorCode?: string) {
    await this._channel.abort({ errorCode });
  }

  async fulfill(response: FulfillResponse & { path?: string }) {
    const normalized = await normalizeFulfillParameters(response);
    await this._channel.fulfill(normalized);
  }

  async continue(overrides: ContinueOverrides = {}) {
    const normalized = normalizeContinueOverrides(overrides);
    await this._channel.continue({
      method: normalized.method,
      headers: normalized.headers,
      postData: normalized.postData ? normalized.postData.toString('base64') : undefined
    });
  }
}

export type RouteHandler = (route: Route, request: Request) => void;

export class Response extends ChannelOwner<ResponseChannel, ResponseInitializer> {
  private _headers: Headers;

  static from(response: ResponseChannel): Response {
    return (response as any)._object;
  }

  static fromNullable(response: ResponseChannel | undefined): Response | null {
    return response ? Response.from(response) : null;
  }

  constructor(parent: ChannelOwner, type: string, guid: string, initializer: ResponseInitializer) {
    super(parent, type, guid, initializer);
    this._headers = headersArrayToObject(initializer.headers);
  }

  url(): string {
    return this._initializer.url;
  }

  ok(): boolean {
    return this._initializer.status === 0 || (this._initializer.status >= 200 && this._initializer.status <= 299);
  }

  status(): number {
    return this._initializer.status;
  }

  statusText(): string {
    return this._initializer.statusText;
  }

  headers(): Headers {
    return { ...this._headers };
  }

  async finished(): Promise<Error | null> {
    const result = await this._channel.finished();
    if (result.error)
      return new Error(result.error);
    return null;
  }

  async body(): Promise<Buffer> {
    return Buffer.from((await this._channel.body()).binary, 'base64');
  }

  async text(): Promise<string> {
    const content = await this.body();
    return content.toString('utf8');
  }

  async json(): Promise<object> {
    const content = await this.text();
    return JSON.parse(content);
  }

  request(): Request {
    return Request.from(this._initializer.request);
  }

  frame(): Frame {
    return Request.from(this._initializer.request).frame();
  }
}
