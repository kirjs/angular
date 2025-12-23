/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {Injector, WritableSignal, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {FormControlStatus, FormGroup} from '@angular/forms';
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
