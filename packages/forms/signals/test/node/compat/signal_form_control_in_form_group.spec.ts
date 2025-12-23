/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {Injector, WritableSignal, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {FormControlStatus, FormGroup, ValidationErrors} from '@angular/forms';
import {SignalFormControlFactory} from '../../../compat/src/signal_form_control/signal_form_control';
import {required} from '../../../public_api';
import {SchemaFn} from '../../../src/api/types';

function createSignalFormControl<T>(value: WritableSignal<T>, schema?: SchemaFn<T>) {
  const injector = TestBed.inject(Injector);
  return SignalFormControlFactory(value, schema, injector);
}

describe('SignalFormControl in FormGroup', () => {
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

  it('should propagate patchValue updates from child to parent', () => {
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

  it('should update signal when parent setValue is called', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);
    const group = new FormGroup({
      n: form,
    });

    group.setValue({n: 20});
    TestBed.flushEffects();

    expect(value()).toBe(20);
    expect(form.value).toBe(20);
  });

  it('should update signal when parent patchValue is called', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);
    const group = new FormGroup({
      n: form,
    });

    group.patchValue({n: 30});
    TestBed.flushEffects();

    expect(value()).toBe(30);
    expect(form.value).toBe(30);
  });

  it('should reset child value and state when parent reset is called', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);
    const group = new FormGroup({
      n: form,
    });

    form.markAsDirty();
    form.markAsTouched();
    expect(form.dirty).toBe(true);
    expect(form.touched).toBe(true);

    group.reset({n: 50});
    TestBed.flushEffects();

    expect(value()).toBe(50);
    expect(form.dirty).toBe(false);
    expect(form.touched).toBe(false);
  });

  it('should mark child as touched when parent markAllAsTouched is called', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);
    const group = new FormGroup({
      n: form,
    });

    expect(form.touched).toBe(false);

    group.markAllAsTouched();
    TestBed.flushEffects();

    expect(form.touched).toBe(true);
  });

  it('should mark child as pristine when parent markAsPristine is called', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);
    const group = new FormGroup({
      n: form,
    });

    form.markAsDirty();
    expect(form.dirty).toBe(true);

    group.markAsPristine();
    TestBed.flushEffects();

    expect(form.dirty).toBe(false);
    expect(form.pristine).toBe(true);
  });

  it('should mark child as untouched when parent markAsUntouched is called', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);
    const group = new FormGroup({
      n: form,
    });

    form.markAsTouched();
    expect(form.touched).toBe(true);

    group.markAsUntouched();
    TestBed.flushEffects();

    expect(form.touched).toBe(false);
  });

  it('should include child value in parent getRawValue', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);
    const group = new FormGroup({
      n: form,
    });

    expect(group.getRawValue()).toEqual({n: 10});

    form.setValue(99);
    expect(group.getRawValue()).toEqual({n: 99});
  });

  it('should support cross-field validators on parent', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);
    const group = new FormGroup(
      {
        n: form,
      },
      {
        validators: (g) => {
          const val = g.get('n')?.value;
          return val > 5 ? null : {min: true};
        },
      },
    );

    expect(group.valid).toBe(true);

    form.setValue(1);
    TestBed.flushEffects();

    expect(group.valid).toBe(false);
    expect(group.errors).toEqual({min: true});
  });

  it('should allow retrieving child control using get()', () => {
    const value = signal(10);
    const form = createSignalFormControl(value);
    const group = new FormGroup({
      n: form,
    });

    const retrieved = group.get('n');
    expect(retrieved).toBe(form);
    expect(retrieved?.value).toBe(10);
  });

  it('should emit parent statusChanges when child validity changes', () => {
    const value = signal<number | undefined>(10);
    const form = createSignalFormControl(value, (p) => required(p));
    const group = new FormGroup({
      n: form,
    });

    const statuses: FormControlStatus[] = [];
    group.statusChanges.subscribe((s) => statuses.push(s));

    form.setValue(undefined);
    TestBed.flushEffects();

    expect(statuses).toContain('INVALID');
    expect(group.status).toBe('INVALID');
  });
});
