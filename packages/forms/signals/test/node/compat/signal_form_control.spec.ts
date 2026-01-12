/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ApplicationRef, Injector, resource, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {FormControlStatus, FormGroup} from '@angular/forms';
import {
  SignalFormControl,
  SignalFormControlFactory,
} from '../../../compat/src/signal_form_control/signal_form_control';
import {disabled, required, validateAsync, ValidationError} from '../../../public_api';
import {SchemaFn} from '../../../src/api/types';

function createSignalFormControl<T>(initialValue: T, schema?: SchemaFn<T>) {
  const injector = TestBed.inject(Injector);
  return SignalFormControlFactory(initialValue, schema, {injector});
}

/**
 * Open questions:
 * - Disable/Enable should throw an error?
 */
describe('SignalFormControl', () => {
  describe('value and state access', () => {
    it('should have the same value as the signal', () => {
      const form = createSignalFormControl(10);

      expect(form.value).toBe(10);
      form.setValue(20);
      expect(form.value).toBe(20);
    });

    it('should expose fieldTree', () => {
      const form = createSignalFormControl(10);
      expect(form.fieldTree().value()).toBe(10);

      form.setValue(20);
      expect(form.fieldTree().value()).toBe(20);
    });

    it('should return value for getRawValue', () => {
      const form = createSignalFormControl(10);
      expect(form.getRawValue()).toBe(10);
    });
  });

  describe('validation', () => {
    it('should validate', () => {
      const form = createSignalFormControl<number | undefined>(undefined, (p) => {
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
      const form = createSignalFormControl<number | undefined>(undefined, (p) => {
        required(p);
      });

      let errors = form.errors;
      expect(errors).not.toBeNull();
      expect(errors!['required']).toEqual(jasmine.objectContaining({kind: 'required'}));

      form.setValue(1);
      errors = form.errors;
      expect(errors).toBeNull();
    });

    it('should expose pending status for async validators', async () => {
      const pendingResolvers: Array<(errors: ValidationError[]) => void> = [];
      const resolveNext = (errors: ValidationError[]) => {
        TestBed.flushEffects();
        expect(pendingResolvers.length).toBeGreaterThan(0);
        pendingResolvers.shift()!(errors);
      };

      const form = createSignalFormControl('initial', (p) => {
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

      resolveNext([{kind: 'async-invalid'}]);
      await appRef.whenStable();
      TestBed.flushEffects();

      expect(form.pending).toBe(false);
      expect(form.status).toBe('INVALID');
      expect(form.errors?.['async-invalid']).toEqual(
        jasmine.objectContaining({kind: 'async-invalid'}),
      );
    });

    it('should support disabled via rules', () => {
      const form = createSignalFormControl(10, (p) => {
        disabled(p, ({value}) => value() > 15);
      });

      expect(form.disabled).toBe(false);
      expect(form.status).toBe('VALID');

      form.setValue(20);

      expect(form.disabled).toBe(true);
      expect(form.status).toBe('DISABLED');
    });
  });

  describe('status management (dirty/touched)', () => {
    it('should support markAsTouched', () => {
      const form = createSignalFormControl(10);

      expect(form.touched).toBe(false);
      form.markAsTouched();
      expect(form.touched).toBe(true);
    });

    it('should support markAsDirty', () => {
      const form = createSignalFormControl(10);

      expect(form.dirty).toBe(false);
      form.markAsDirty();
      expect(form.dirty).toBe(true);
    });

    it('should support markAsPristine', () => {
      const form = createSignalFormControl(10);

      form.markAsDirty();
      expect(form.dirty).toBe(true);

      form.markAsPristine();
      expect(form.dirty).toBe(false);
    });

    it('should support markAsUntouched', () => {
      const form = createSignalFormControl(10);

      form.markAsTouched();
      expect(form.touched).toBe(true);

      form.markAsUntouched();
      expect(form.touched).toBe(false);
    });
  });

  describe('observables and events', () => {
    it('should emit valueChanges when the value updates', () => {
      const form = createSignalFormControl(10);
      const emissions: number[] = [];

      form.valueChanges.subscribe((v) => emissions.push(v));

      form.setValue(20);
      TestBed.flushEffects();
      expect(emissions).toEqual([20]);

      form.setValue(30);
      TestBed.flushEffects();
      expect(emissions).toEqual([20, 30]);
    });

    it('should emit statusChanges when validity toggles', () => {
      const form = createSignalFormControl<number | undefined>(undefined, (p) => {
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

    it('should emit ValueChangeEvent on events observable', () => {
      const form = createSignalFormControl(10);
      const events: any[] = [];

      form.events.subscribe((e) => events.push(e));

      form.setValue(20);
      TestBed.flushEffects();

      const valueEvents = events.filter((e) => e.constructor.name === 'ValueChangeEvent');
      expect(valueEvents.length).toBeGreaterThan(0);
      expect(valueEvents[valueEvents.length - 1].value).toBe(20);
    });

    it('should emit StatusChangeEvent on events observable when status changes', () => {
      const form = createSignalFormControl<number | undefined>(10, (p) => required(p));

      // Flush initial effects to set up tracking
      TestBed.flushEffects();

      const events: any[] = [];
      form.events.subscribe((e) => events.push(e));

      form.setValue(undefined);
      TestBed.flushEffects();

      const statusEvents = events.filter((e) => e.constructor.name === 'StatusChangeEvent');
      expect(statusEvents.length).toBeGreaterThan(0);
      expect(statusEvents[statusEvents.length - 1].status).toBe('INVALID');
    });

    it('should emit TouchedChangeEvent on events observable', () => {
      const form = createSignalFormControl(10);

      // Flush initial effects to set up tracking
      TestBed.flushEffects();

      const events: any[] = [];
      form.events.subscribe((e) => events.push(e));

      form.markAsTouched();
      TestBed.flushEffects();

      const touchedEvents = events.filter((e) => e.constructor.name === 'TouchedChangeEvent');
      expect(touchedEvents.length).toBe(1);
      expect(touchedEvents[0].touched).toBe(true);
    });

    it('should emit PristineChangeEvent on events observable when dirty changes', () => {
      const form = createSignalFormControl(10);

      // Flush initial effects to set up tracking
      TestBed.flushEffects();

      const events: any[] = [];
      form.events.subscribe((e) => events.push(e));

      form.markAsDirty();
      TestBed.flushEffects();

      const pristineEvents = events.filter((e) => e.constructor.name === 'PristineChangeEvent');
      expect(pristineEvents.length).toBeGreaterThan(0);
      expect(pristineEvents[pristineEvents.length - 1].pristine).toBe(false);
    });
  });

  describe('integration with parent', () => {
    it('should synchronize value with parent FormGroup immediately', () => {
      const child = createSignalFormControl('meow');
      const group = new FormGroup({
        child: child,
      });

      child.fieldTree().value.set('wuf');
      expect(group.value).toEqual({child: 'wuf'});
    });

    it('should synchronize nested value with parent FormGroup immediately', () => {
      const child = createSignalFormControl({name: 'pirojok', says: 'meow'});
      const group = new FormGroup({
        child: child,
      });

      child.fieldTree.says().value.set('wuf');
      expect(group.value).toEqual({child: {name: 'pirojok', says: 'wuf'}});
    });

    it('should propagate validity to parent FormGroup immediately', () => {
      const child = createSignalFormControl<string>('valid', (p) => required(p));
      const group = new FormGroup({
        child: child,
      });

      expect(group.valid).withContext('Valid initially').toBe(true);
      child.fieldTree().value.set('');
      expect(group.valid).withContext('Invalid immediately on value change').toBe(false);
      group.controls.child.setValue('meow');
      expect(group.valid).withContext('Valid initially').toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset touched and dirty state', () => {
      const form = createSignalFormControl(10);

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
      const form = createSignalFormControl(10);

      form.markAsTouched();
      form.markAsDirty();

      form.reset(42);
      expect(form.value).toBe(42);
      expect(form.source()).toBe(42);
      expect(form.touched).toBe(false);
      expect(form.dirty).toBe(false);
    });

    it('should unbox value in reset', () => {
      const form = createSignalFormControl(10);
      form.reset({value: 20, disabled: true});
      expect(form.value).toBe(20);

      expect(form.value).toBe(20);

      expect(form.disabled).toBe(false);
    });

    it('should NOT unbox value in reset if it has extra keys', () => {
      const form = createSignalFormControl<any>(10);
      const complexValue = {value: 20, disabled: true, extra: 1};
      form.reset(complexValue);
      expect(form.value).toEqual(complexValue);
    });

    it('should emit FormResetEvent on reset', () => {
      const form = createSignalFormControl(10);
      const events: any[] = [];
      form.events.subscribe((e) => events.push(e));

      form.reset(20);
      const resetEvents = events.filter((e) => e.constructor.name === 'FormResetEvent');
      expect(resetEvents.length).toBe(1);
    });

    it('should NOT emit FormResetEvent on reset when emitEvent is false', () => {
      const form = createSignalFormControl(10);
      const events: any[] = [];
      form.events.subscribe((e) => events.push(e));

      form.reset(20, {emitEvent: false});
      const resetEvents = events.filter((e) => e.constructor.name === 'FormResetEvent');
      expect(resetEvents.length).toBe(0);
    });
  });

  describe('unsupported methods', () => {
    it('should throw error when calling disable()', () => {
      const form = createSignalFormControl(10);
      expect(() => form.disable()).toThrowError(
        /Imperatively changing enabled\/disabled status in form control is not supported/,
      );
    });

    it('should throw error when calling enable()', () => {
      const form = createSignalFormControl(10);
      expect(() => form.enable()).toThrowError(
        /Imperatively changing enabled\/disabled status in form control is not supported/,
      );
    });

    it('should throw error when calling setValidators()', () => {
      const form = createSignalFormControl(10);
      expect(() => form.setValidators(null)).toThrowError(
        /Dynamically adding and removing validators is not supported/,
      );
    });

    it('should throw error when calling setAsyncValidators()', () => {
      const form = createSignalFormControl(10);
      expect(() => form.setAsyncValidators(null)).toThrowError(
        /Dynamically adding and removing validators is not supported/,
      );
    });

    it('should throw error when calling addValidators()', () => {
      const form = createSignalFormControl(10);
      expect(() => form.addValidators([])).toThrowError(
        /Dynamically adding and removing validators is not supported/,
      );
    });

    it('should throw error when calling addAsyncValidators()', () => {
      const form = createSignalFormControl(10);
      expect(() => form.addAsyncValidators([])).toThrowError(
        /Dynamically adding and removing validators is not supported/,
      );
    });

    it('should throw error when calling removeValidators()', () => {
      const form = createSignalFormControl(10);
      expect(() => form.removeValidators([])).toThrowError(
        /Dynamically adding and removing validators is not supported/,
      );
    });

    it('should throw error when calling removeAsyncValidators()', () => {
      const form = createSignalFormControl(10);
      expect(() => form.removeAsyncValidators([])).toThrowError(
        /Dynamically adding and removing validators is not supported/,
      );
    });

    it('should throw error when calling clearValidators()', () => {
      const form = createSignalFormControl(10);
      expect(() => form.clearValidators()).toThrowError(
        /Dynamically adding and removing validators is not supported/,
      );
    });

    it('should throw error when calling clearAsyncValidators()', () => {
      const form = createSignalFormControl(10);
      expect(() => form.clearAsyncValidators()).toThrowError(
        /Dynamically adding and removing validators is not supported/,
      );
    });

    it('should throw error when calling setErrors()', () => {
      const form = createSignalFormControl(10);
      expect(() => form.setErrors(null)).toThrowError(
        /Imperatively setting errors is not supported in signal forms/,
      );
    });

    it('should throw error when calling markAsPending()', () => {
      const form = createSignalFormControl(10);
      expect(() => form.markAsPending()).toThrowError(
        /Imperatively marking as pending is not supported in signal forms/,
      );
    });
  });
});
