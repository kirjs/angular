/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {signal, WritableSignal, EventEmitter, Injector} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {AbstractControl, ValidationErrors, ValidatorFn} from '@angular/forms';
import {compatForm} from '../../../compat/src/api/compat_form';
import {required} from '../../../public_api';
import {SchemaFn} from '../../../src/api/types';

// Mocking the behavior for now as a minimal implementation
class SignalFormControl<T> extends AbstractControl {
  private field;

  constructor(
    public source: WritableSignal<T>,
    schema?: SchemaFn<T>,
  ) {
    super(null, null);

    const injector = TestBed.inject(Injector);
    if (schema) {
      this.field = compatForm(source, schema, {injector});
    } else {
      this.field = compatForm(source, {injector});
    }

    Object.defineProperty(this, 'value', {
      get: () => this.source(),
      enumerable: true,
      configurable: true,
    });

    // AbstractControl expects these to be initialized
    (this as unknown as {valueChanges: EventEmitter<any>}).valueChanges = new EventEmitter();
    (this as unknown as {statusChanges: EventEmitter<any>}).statusChanges = new EventEmitter();

    // Bridge validation
    this.validator = () => {
      const errors = this.field().errors();
      if (!errors || errors.length === 0) return null;
      // Convert Array of errors to Map of errors for Reactive Forms
      const result: ValidationErrors = {};
      for (const error of errors) {
        result[error.kind] = error;
      }
      return result;
    };
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
  schema?: SchemaFn<T>,
): SignalFormControl<T> {
  return new SignalFormControl(source, schema);
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
    // Initialize with undefined so required() fails
    const value = signal<number | undefined>(undefined);

    // Pass the schema function directly
    const form = SignalFormControlFactory(value, (p) => {
      required(p);
    });

    // We need to call updateValueAndValidity to sync the validation status
    // because AbstractControl doesn't run it automatically on construction against the external signal source
    form.updateValueAndValidity();

    expect(form.valid).toBe(false);

    form.setValue(100);
    expect(form.valid).toBe(true);

    form.setValue(undefined);
    expect(form.valid).toBe(false);
  });
});
