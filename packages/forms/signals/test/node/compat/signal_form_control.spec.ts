/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {signal, WritableSignal} from '@angular/core';

class SignalFormControl {
  constructor(private readonly _signal: WritableSignal<string>) {}

  get value(): string {
    return this._signal();
  }
}

describe('SignalFormControl', () => {
  it('should create a control with a signal value', () => {
    const control = new SignalFormControl(signal('cat'));

    expect(control.value).toBe('cat');
  });
});
