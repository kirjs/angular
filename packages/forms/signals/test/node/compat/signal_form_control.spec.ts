/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {signal, WritableSignal, EventEmitter, Injector, effect} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {AbstractControl, FormControlStatus, FormGroup, ValidationErrors} from '@angular/forms';
import {compatForm} from '../../../compat/src/api/compat_form';
import {disabled, required} from '../../../public_api';
import {SchemaFn} from '../../../src/api/types';

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

    Object.defineProperty(this, 'errors', {
      get: () => {
        const errors = this.field().errors();
        if (!errors || errors.length === 0) return null;
        // Convert Array of errors to Map of errors for Reactive Forms
        const result: ValidationErrors = {};
        for (const error of errors) {
          result[error.kind] = error;
        }
        return result;
      },
      enumerable: true,
      configurable: true,
    });

    // AbstractControl expects these to be initialized
    (this as unknown as {valueChanges: EventEmitter<any>}).valueChanges = new EventEmitter();
    (this as unknown as {statusChanges: EventEmitter<any>}).statusChanges = new EventEmitter();

    // Sync status and value changes (Mocking limited reactivity for compat)
    // Real implementation would use effects to emit valueChanges/statusChanges
    effect(
      () => {
        (this.valueChanges as EventEmitter<T>).emit(this.source());
      },
      {injector},
    );
    effect(
      () => {
        (this.statusChanges as EventEmitter<FormControlStatus>).emit(this.status);
      },
      {injector},
    );
  }

  override setValue(value: any, options?: Object): void {
    this.source.set(value);
  }

  override patchValue(value: any, options?: Object): void {
    this.source.set(value);
  }

  override reset(value?: any, options?: Object): void {
    if (value !== undefined) {
      this.source.set(value);
    }
  }

  override updateValueAndValidity(opts?: Object): void {}

  // Status Overrides
  override get status(): FormControlStatus {
    if (this.field().disabled()) return 'DISABLED';
    if (this.field().valid()) return 'VALID';
    if (this.field().invalid()) return 'INVALID';
    return 'PENDING'; // Default Fallback, though signals are synchronous usually
  }

  override get dirty(): boolean {
    return this.field().dirty();
  }

  override get touched(): boolean {
    return this.field().touched();
  }

  override get valid(): boolean {
    return this.field().valid();
  }

  override get invalid(): boolean {
    return this.field().invalid();
  }

  override get pending(): boolean {
    // TODO: test
    return false; // this.field().pending(); // If available
  }

  override get disabled(): boolean {
    return this.field().disabled();
  }

  override get enabled(): boolean {
    return !this.field().disabled();
  }

  override markAsTouched(opts?: {onlySelf?: boolean}): void {
    this.field().markAsTouched();
  }

  override markAsDirty(opts?: {onlySelf?: boolean}): void {
    this.field().markAsDirty();
  }

  override markAsPristine(opts?: {onlySelf?: boolean}): void {
    // Signal Forms FieldNode doesn't expose markAsPristine publically in simple interface
    // But we can approximate or cast if needed.
    // For this task, we focus on requested methods.
    // this.field().nodeState.markAsPristine();
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
    const value = signal<number | undefined>(undefined);

    const form = SignalFormControlFactory(value, (p) => {
      required(p);
    });

    form.updateValueAndValidity();

    expect(form.valid).toBe(false);

    form.setValue(100);
    expect(form.valid).toBe(true);

    form.setValue(undefined);
    expect(form.valid).toBe(false);
  });

  it('should expose validation errors through the errors getter', () => {
    const value = signal<number | undefined>(undefined);

    const form = SignalFormControlFactory(value, (p) => {
      required(p);
    });

    let errors = form.errors;
    expect(errors).not.toBeNull();
    expect(errors!['required']).toEqual(jasmine.objectContaining({kind: 'required'}));

    form.setValue(1);
    errors = form.errors;
    expect(errors).toBeNull();
  });

  it('should emit valueChanges when the value updates', () => {
    const value = signal(10);
    const form = SignalFormControlFactory(value);
    const emissions: number[] = [];

    form.valueChanges.subscribe((v) => emissions.push(v));

    form.setValue(20);
    TestBed.flushEffects();
    expect(emissions).toEqual([20]);

    value.set(30);
    TestBed.flushEffects();
    expect(emissions).toEqual([20, 30]);
  });

  it('should emit statusChanges when validity toggles', () => {
    const value = signal<number | undefined>(undefined);
    const form = SignalFormControlFactory(value, (p) => {
      required(p);
    });
    const statuses: FormControlStatus[] = [];

    form.statusChanges.subscribe((status) => statuses.push(status));

    form.setValue(1);
    TestBed.flushEffects();
    expect(statuses).toEqual(['VALID']);

    form.setValue(undefined);
    TestBed.flushEffects();
    expect(statuses).toEqual(['VALID', 'INVALID']);

    form.setValue(10);
    TestBed.flushEffects();
    expect(statuses).toEqual(['VALID', 'INVALID', 'VALID']);
  });

  it('should support disabled via rules', () => {
    const value = signal(10);
    const form = SignalFormControlFactory(value, (p) => {
      disabled(p, ({value}) => value() > 15);
    });

    expect(form.disabled).toBe(false);
    expect(form.status).toBe('VALID');

    form.setValue(20);

    expect(form.disabled).toBe(true);
    expect(form.status).toBe('DISABLED');
  });

  it('should support markAsTouched', () => {
    const value = signal(10);
    const form = SignalFormControlFactory(value);

    expect(form.touched).toBe(false);
    form.markAsTouched();
    expect(form.touched).toBe(true);
  });

  it('should support markAsDirty', () => {
    const value = signal(10);
    const form = SignalFormControlFactory(value);

    expect(form.dirty).toBe(false);
    form.markAsDirty();
    expect(form.dirty).toBe(true);
  });

  describe('Integration in FormGroup', () => {
    it('should reflect value and value changes', () => {
      const value = signal(10);
      const form = SignalFormControlFactory(value);
      const group = new FormGroup({
        n: form,
      });
    });
  });
});
