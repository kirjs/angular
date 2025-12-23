/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ApplicationRef, Injector, WritableSignal, resource, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {FormControlStatus} from '@angular/forms';
import {SignalFormControlFactory} from '../../../compat/src/signal_form_control/signal_form_control';
import {customError, disabled, required, validateAsync, ValidationError} from '../../../public_api';
import {SchemaFn} from '../../../src/api/types';

function createSignalFormControl<T>(value: WritableSignal<T>, schema?: SchemaFn<T>) {
  const injector = TestBed.inject(Injector);
  return SignalFormControlFactory(value, schema, injector);
}

/**
 * Open questions:
 * - Disable/Enable should throw an error?
 */
describe('SignalFormControl', () => {
  it('should have the same value as the signal', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);

    expect(form.value).toBe(10);
    value.set(20);
    expect(form.value).toBe(20);
  });

  it('should validate', () => {
    const value = signal<number | undefined>(undefined);

    const form = createSignalFormControl(value, (p) => {
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

    const form = createSignalFormControl(value, (p) => {
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
    const form = createSignalFormControl(value);
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
    const form = createSignalFormControl(value, (p) => {
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

  it('should expose pending status for async validators', async () => {
    const value = signal('initial');
    const pendingResolvers: Array<(errors: ValidationError[]) => void> = [];
    const resolveNext = (errors: ValidationError[]) => {
      TestBed.flushEffects();
      expect(pendingResolvers.length).toBeGreaterThan(0);
      pendingResolvers.shift()!(errors);
    };
    const form = createSignalFormControl(value, (p) => {
      validateAsync(p, {
        params: ({value}) => value(),
        factory: (params) =>
          resource({
            params,
            loader: () =>
              new Promise<ValidationError[]>((resolve) => {
                pendingResolvers.push(resolve);
              }),
          }),
        onSuccess: (errors) => errors,
        onError: () => null,
      });
    });
    const appRef = TestBed.inject(ApplicationRef);

    expect(form.pending).toBe(true);
    expect(form.status).toBe('PENDING');

    resolveNext([]);
    await appRef.whenStable();
    TestBed.flushEffects();

    expect(form.pending).toBe(false);
    expect(form.status).toBe('VALID');

    form.setValue('invalid');
    TestBed.flushEffects();

    expect(form.pending).toBe(true);
    expect(form.status).toBe('PENDING');

    resolveNext([customError({kind: 'async-invalid'})]);
    await appRef.whenStable();
    TestBed.flushEffects();

    expect(form.pending).toBe(false);
    expect(form.status).toBe('INVALID');
    expect(form.errors?.['async-invalid']).toEqual(
      jasmine.objectContaining({kind: 'async-invalid'}),
    );
  });

  it('should support disabled via rules', () => {
    const value = signal(10);
    const form = createSignalFormControl(value, (p) => {
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
    const form = createSignalFormControl(value);

    expect(form.touched).toBe(false);
    form.markAsTouched();
    expect(form.touched).toBe(true);
  });

  it('should support markAsDirty', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);

    expect(form.dirty).toBe(false);
    form.markAsDirty();
    expect(form.dirty).toBe(true);
  });

  it('should support markAsPristine', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);

    form.markAsDirty();
    expect(form.dirty).toBe(true);

    form.markAsPristine();
    expect(form.dirty).toBe(false);
  });

  it('should support markAsUntouched', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);

    form.markAsTouched();
    expect(form.touched).toBe(true);

    form.markAsUntouched();
    expect(form.touched).toBe(false);
  });

  it('should reset touched and dirty state', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);

    form.markAsTouched();
    form.markAsDirty();
    expect(form.touched).toBe(true);
    expect(form.dirty).toBe(true);

    form.reset(10);
    expect(form.touched).toBe(false);
    expect(form.dirty).toBe(false);
    expect(form.value).toBe(10);
  });

  it('should reset with a new value', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);

    form.markAsTouched();
    form.markAsDirty();

    form.reset(42);
    expect(form.value).toBe(42);
    expect(value()).toBe(42);
    expect(form.touched).toBe(false);
    expect(form.dirty).toBe(false);
  });
});
