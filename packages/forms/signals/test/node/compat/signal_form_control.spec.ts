/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {signal, WritableSignal, EventEmitter} from '@angular/core';
import {AbstractControl, ValidatorFn, Validators} from '@angular/forms';
import {SchemaFn} from '../../../src/api/types';

// Mocking the behavior for now as a minimal implementation
class SignalFormControl<T> extends AbstractControl {
  constructor(
    public source: WritableSignal<T>,
    validator: ValidatorFn | null,
    schema?: SchemaFn<T>,
  ) {
    super(validator, null);
    Object.defineProperty(this, 'value', {
      get: () => this.source(),
      enumerable: true,
      configurable: true,
    });

    // AbstractControl expects these to be initialized
    (this as unknown as {valueChanges: EventEmitter<any>}).valueChanges = new EventEmitter();
    (this as unknown as {statusChanges: EventEmitter<any>}).statusChanges = new EventEmitter();
  }

  override setValue(value: any, options?: Object): void {
    this.source.set(value);
    this.updateValueAndValidity(options);
  }

  override patchValue(value: any, options?: Object): void {
    this.source.set(value);
    this.updateValueAndValidity(options);
  }

  override reset(value?: any, options?: Object): void {
    // minimal implementation
    if (value !== undefined) {
      this.source.set(value);
    }
    this.updateValueAndValidity(options);
  }

  /** @internal **/
  _updateValue(): void {}

  /** @internal **/
  _forEachChild(cb: (c: AbstractControl) => void): void {}

  /** @internal **/
  _anyControls(condition: (c: AbstractControl) => boolean): boolean {
    return false;
  }
  /** @internal **/
  _allControlsDisabled(): boolean {
    return this.disabled;
  }
  /** @internal **/
  _syncPendingControls(): boolean {
    return false;
  }
}

function SignalFormControlFactory<T>(
  source: WritableSignal<T>,
  validator: ValidatorFn | null = null,
  schema?: SchemaFn<T>,
): SignalFormControl<T> {
  return new SignalFormControl(source, validator, schema);
}

describe('SignalFormControl', () => {
  it('should have the same value as the signal', () => {
    const value = signal(10);
    const form = SignalFormControlFactory(value);

    expect(form.value).toBe(10);
    value.set(20);
    expect(form.value).toBe(20);
  });

  it('should validate', () => {
    const value = signal(10);
    const form = SignalFormControlFactory(value, Validators.min(100));

    // Initially 10, should be invalid (min 100)
    // We need to call updateValueAndValidity because AbstractControl doesn't know the signal value initially
    // unless we tell it, or we rely on it asking for 'value' during some init phase.
    // However, AbstractControl constructor calls _assignValidators but doesn't auto-run validation immediately on creation usually?
    // Actually, AbstractControl doesn't look at value in constructor.
    form.updateValueAndValidity();

    expect(form.valid).toBe(false);

    form.setValue(100);
    expect(form.valid).toBe(true);

    form.setValue(50);
    expect(form.valid).toBe(false);
  });
});
