/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ApplicationRef, Injector, WritableSignal, resource, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {FormControlStatus, FormGroup} from '@angular/forms';
import {SignalFormControlFactory} from '../../../compat/src/signal_form_control/signal_form_control';
import {customError, disabled, required, validateAsync, ValidationError} from '../../../public_api';
import {SchemaFn} from '../../../src/api/types';

function createSignalFormControl<T>(value: WritableSignal<T>, schema?: SchemaFn<T>) {
  const injector = TestBed.inject(Injector);
  return SignalFormControlFactory(value, schema, injector);
}

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

  describe('Integration in FormGroup', () => {
    it('should reflect value and value changes', () => {
      const value = signal(10);
      const form = createSignalFormControl(value);
      const group = new FormGroup({
        n: form,
      });

      expect(group.value).toEqual({n: 10});

      const emissions: any[] = [];
      group.valueChanges.subscribe((v) => emissions.push(v));

      form.setValue(20);

      expect(group.value).toEqual({n: 20});
    });

    it('should propagate patchValue updates', () => {
      const value = signal(5);
      const form = createSignalFormControl(value);
      const group = new FormGroup({
        n: form,
      });

      const emissions: any[] = [];
      group.valueChanges.subscribe((v) => emissions.push(v));

      form.patchValue(15);

      expect(group.value).toEqual({n: 15});
      expect(emissions).toEqual([{n: 15}]);
      expect(form.value).toBe(15);
      expect(value()).toBe(15);
    });

    it('should reflect validity changes', () => {
      const value = signal<number | undefined>(10);
      const form = createSignalFormControl(value, (p) => required(p));
      const group = new FormGroup({
        n: form,
      });

      expect(group.status).toBe('VALID');

      const statuses: FormControlStatus[] = [];
      group.statusChanges.subscribe((status) => statuses.push(status));

      form.setValue(undefined);
      expect(group.status).toBe('INVALID');

      form.setValue(10);
      expect(group.status).toBe('VALID');

      expect(statuses).toEqual(['INVALID', 'VALID']);
    });
  });
});
