/**
 * Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as Bidi from 'chromium-bidi/lib/cjs/protocol/protocol.js';

import {ElementHandle} from '../../api/ElementHandle.js';
import {JSHandle as BaseJSHandle} from '../../api/JSHandle.js';
import {EvaluateFuncWith, HandleFor, HandleOr} from '../../common/types.js';
import {withSourcePuppeteerURLIfNone} from '../util.js';

import {Connection} from './Connection.js';
import {Context} from './Context.js';
import {BidiSerializer} from './Serializer.js';
import {releaseReference} from './utils.js';

export class JSHandle<T = unknown> extends BaseJSHandle<T> {
  #disposed = false;
  #context;
  #remoteValue;

  constructor(context: Context, remoteValue: Bidi.CommonDataTypes.RemoteValue) {
    super();
    this.#context = context;
    this.#remoteValue = remoteValue;
  }

  context(): Context {
    return this.#context;
  }

  get connection(): Connection {
    return this.#context.connection;
  }

  override get disposed(): boolean {
    return this.#disposed;
  }

  override async evaluate<
    Params extends unknown[],
    Func extends EvaluateFuncWith<T, Params> = EvaluateFuncWith<T, Params>
  >(
    pageFunction: Func | string,
    ...args: Params
  ): Promise<Awaited<ReturnType<Func>>> {
    pageFunction = withSourcePuppeteerURLIfNone(
      this.evaluate.name,
      pageFunction
    );
    return await this.context().evaluate(pageFunction, this, ...args);
  }

  override async evaluateHandle<
    Params extends unknown[],
    Func extends EvaluateFuncWith<T, Params> = EvaluateFuncWith<T, Params>
  >(
    pageFunction: Func | string,
    ...args: Params
  ): Promise<HandleFor<Awaited<ReturnType<Func>>>> {
    pageFunction = withSourcePuppeteerURLIfNone(
      this.evaluateHandle.name,
      pageFunction
    );
    return await this.context().evaluateHandle(pageFunction, this, ...args);
  }

  override async getProperty<K extends keyof T>(
    propertyName: HandleOr<K>
  ): Promise<HandleFor<T[K]>>;
  override async getProperty(propertyName: string): Promise<HandleFor<unknown>>;
  override async getProperty<K extends keyof T>(
    propertyName: HandleOr<K>
  ): Promise<HandleFor<T[K]>> {
    return await this.evaluateHandle((object, propertyName) => {
      return object[propertyName as K];
    }, propertyName);
  }

  override async getProperties(): Promise<Map<string, BaseJSHandle>> {
    // TODO(lightning00blade): Either include return of depth Handles in RemoteValue
    // or new BiDi command that returns array of remote value
    const keys = await this.evaluate(object => {
      return Object.getOwnPropertyNames(object);
    });
    const map: Map<string, BaseJSHandle> = new Map();
    const results = await Promise.all(
      keys.map(key => {
        return this.getProperty(key);
      })
    );

    for (const [key, value] of Object.entries(keys)) {
      const handle = results[key as any];
      if (handle) {
        map.set(value, handle);
      }
    }

    return map;
  }

  override async jsonValue(): Promise<T> {
    const value = BidiSerializer.deserialize(this.#remoteValue);

    if (this.#remoteValue.type !== 'undefined' && value === undefined) {
      throw new Error('Could not serialize referenced object');
    }
    return value;
  }

  override asElement(): ElementHandle<Node> | null {
    return null;
  }

  override async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    if ('handle' in this.#remoteValue) {
      await releaseReference(this.#context, this.#remoteValue);
    }
  }

  get isPrimitiveValue(): boolean {
    switch (this.#remoteValue.type) {
      case 'string':
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'undefined':
      case 'null':
        return true;

      default:
        return false;
    }
  }

  override toString(): string {
    if (this.isPrimitiveValue) {
      return 'JSHandle:' + BidiSerializer.deserialize(this.#remoteValue);
    }

    return 'JSHandle@' + this.#remoteValue.type;
  }

  override get id(): string | undefined {
    return 'handle' in this.#remoteValue ? this.#remoteValue.handle : undefined;
  }

  remoteValue(): Bidi.CommonDataTypes.RemoteValue {
    return this.#remoteValue;
  }
}
