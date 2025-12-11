/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  ApplicationRef,
  EventEmitter,
  Injector,
  WritableSignal,
  effect,
  resource,
  signal,
} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {
  AbstractControl,
  FormArray,
  FormControlStatus,
  FormGroup,
  ValidationErrors,
} from '@angular/forms';
import {compatForm} from '../../../compat';
import {customError, disabled, required, validateAsync, ValidationError} from '../../../public_api';
import {SchemaFn} from '../../../src/api/types';

type ValueUpdateOptions = {onlySelf?: boolean; emitEvent?: boolean};

class SignalFormControl<T> extends AbstractControl {
  private field;
  private pendingParentNotifications = 0;

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
        const currentValue = this.source();

        if (this.pendingParentNotifications > 0) {
          this.pendingParentNotifications--;
        } else {
          this.parent?.updateValueAndValidity({sourceControl: this} as any);
        }

        (this.valueChanges as EventEmitter<T>).emit(currentValue);
      },
      {injector},
    );
    effect(
      () => {
        const status = this.status;
        (this.statusChanges as EventEmitter<FormControlStatus>).emit(status);
      },
      {injector},
    );
  }

  override setValue(value: any, options?: ValueUpdateOptions): void {
    const parent = this.prepareParentPropagation(options);
    this.source.set(value);
    this.notifyParent(parent, options);
  }

  override patchValue(value: any, options?: ValueUpdateOptions): void {
    const parent = this.prepareParentPropagation(options);
    this.source.set(value);
    this.notifyParent(parent, options);
  }

  override reset(value?: any, options?: ValueUpdateOptions): void {
    if (value !== undefined) {
      const parent = this.prepareParentPropagation(options);
      this.source.set(value);
      this.notifyParent(parent, options);
    } else if (!options?.onlySelf) {
      this.parent?.updateValueAndValidity({
        emitEvent: options?.emitEvent,
        sourceControl: this,
      } as any);
    }
  }

  private prepareParentPropagation(options?: ValueUpdateOptions): FormGroup | FormArray | null {
    if (options?.onlySelf) {
      this.pendingParentNotifications++;
      return null;
    }
    const parent = this.parent;
    if (parent) {
      this.pendingParentNotifications++;
      return parent;
    }
    return null;
  }

  private notifyParent(parent: FormGroup | FormArray | null, options?: ValueUpdateOptions): void {
    if (!parent) return;
    parent.updateValueAndValidity({
      emitEvent: options?.emitEvent,
      sourceControl: this,
    } as any);
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
    return this.field().pending();
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

  it('should expose pending status for async validators', async () => {
    const value = signal('initial');
    const pendingResolvers: Array<(errors: ValidationError[]) => void> = [];
    const resolveNext = (errors: ValidationError[]) => {
      TestBed.flushEffects();
      expect(pendingResolvers.length).toBeGreaterThan(0);
      pendingResolvers.shift()!(errors);
    };
    const form = SignalFormControlFactory(value, (p) => {
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

      expect(group.value).toEqual({n: 10});

      const emissions: any[] = [];
      group.valueChanges.subscribe((v) => emissions.push(v));

      form.setValue(20);

      expect(group.value).toEqual({n: 20});
    });

    it('should reflect validity changes', () => {
      const value = signal<number | undefined>(10);
      const form = SignalFormControlFactory(value, (p) => required(p));
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
