/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {Injector, signal, WritableSignal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {disabled, FieldTree, form, SchemaFn} from '../../../public_api';

function SignalFormControl<TModel = any>(
  signalValue: WritableSignal<TModel>,
  pathConfigFn?: SchemaFn<TModel>,
  options?: {injector: Injector},
): FieldTree<TModel> & {value: TModel} {
  let fieldTree: FieldTree<TModel>;

  if (pathConfigFn && options) {
    fieldTree = form(signalValue, pathConfigFn, options);
  } else if (options) {
    fieldTree = form(signalValue, options);
  } else {
    fieldTree = form(signalValue);
  }

  // Add a value property to the FieldTree
  Object.defineProperty(fieldTree, 'value', {
    get() {
      return fieldTree().value();
    },
    enumerable: true,
    configurable: true,
  });

  return fieldTree as FieldTree<TModel> & {value: TModel};
}

describe('SignalFormControl', () => {
  it('should create a control with a signal value', () => {
    const control = SignalFormControl(signal('cat'));

    expect(control.value).toBe('cat');
  });

  it('should update value when signal changes', () => {
    const catSignal = signal('cat');
    const control = SignalFormControl(catSignal);

    expect(control.value).toBe('cat');

    catSignal.set('dog');
    expect(control.value).toBe('dog');
  });

  it('should disable with reason', () => {
    const f = SignalFormControl(
      signal({a: 1, b: 2}),
      (p) => {
        disabled(p.a, () => 'a cannot be changed');
      },
      {injector: TestBed.inject(Injector)},
    );

    expect(f.a().disabled()).toBe(true);
    expect(f.a().disabledReasons()).toEqual([
      {
        field: f.a,
        message: 'a cannot be changed',
      },
    ]);
    expect(f.b().disabled()).toBe(false);
  });
});
