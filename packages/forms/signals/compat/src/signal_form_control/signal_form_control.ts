/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  EventEmitter,
  Injector,
  WritableSignal,
  effect,
  ɵRuntimeError as RuntimeError,
} from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormControlStatus,
  FormGroup,
  PristineChangeEvent,
  StatusChangeEvent,
  TouchedChangeEvent,
  ValidationErrors,
  ValueChangeEvent,
  FormResetEvent,
} from '@angular/forms';

import {compatForm} from '../api/compat_form';
import {FieldState, FieldTree, SchemaFn} from '../../../src/api/types';
import {SignalFormsErrorCode} from '../../../src/errors';
import {removeListItem} from '../../../../src/util';

export type ValueUpdateOptions = {
  onlySelf?: boolean;
  emitEvent?: boolean;
  emitModelToViewChange?: boolean;
  emitViewToModelChange?: boolean;
};

export class SignalFormControl<T> extends AbstractControl {
  fieldState!: FieldState<T>;

  private readonly field: FieldTree<T>;
  private pendingParentNotifications = 0;
  private readonly onChangeCallbacks: Array<(value?: any, emitModelEvent?: boolean) => void> = [];
  private readonly onDisabledChangeCallbacks: Array<(isDisabled: boolean) => void> = [];

  // Track previous states to emit events only on actual changes
  private lastState = {
    status: undefined as FormControlStatus | undefined,
    disabled: undefined as boolean | undefined,
    touched: undefined as boolean | undefined,
    dirty: undefined as boolean | undefined,
  };

  constructor(
    public source: WritableSignal<T>,
    injector: Injector,
    schema?: SchemaFn<T>,
  ) {
    super(null, null);

    this.field = schema ? compatForm(source, schema, {injector}) : compatForm(source, {injector});

    this.defineProperties();
    this.setupEffects(injector);
  }

  private defineProperties(): void {
    Object.defineProperty(this, 'value', {
      get: () => this.source(),
      enumerable: true,
      configurable: true,
    });

    Object.defineProperty(this, 'fieldState', {
      get: () =>
        wrapFieldStateForSyncUpdates(this.field(), () =>
          this.parent?.updateValueAndValidity({sourceControl: this} as any),
        ),
      enumerable: true,
      configurable: true,
    });

    Object.defineProperty(this, 'errors', {
      get: () => {
        const errors = this.field().errors();
        if (!errors?.length) return null;
        return Object.fromEntries(errors.map((e) => [e.kind, e])) as ValidationErrors;
      },
      enumerable: true,
      configurable: true,
    });

    (this as any).valueChanges = new EventEmitter();
    (this as any).statusChanges = new EventEmitter();
  }

  private setupEffects(injector: Injector): void {
    // Value changes
    effect(
      () => {
        const value = this.source();
        if (this.pendingParentNotifications > 0) {
          this.pendingParentNotifications--;
        } else {
          this.parent?.updateValueAndValidity({sourceControl: this} as any);
        }
        (this.valueChanges as EventEmitter<T>).emit(value);
        (this as any)._events.next(new ValueChangeEvent(value, this));
      },
      {injector},
    );

    // Status and disabled changes
    effect(
      () => {
        const status = this.status;
        (this.statusChanges as EventEmitter<FormControlStatus>).emit(status);
        this.emitOnChange('status', status, () =>
          (this as any)._events.next(new StatusChangeEvent(status, this)),
        );
        this.emitOnChange('disabled', this.disabled, (isDisabled) =>
          this.onDisabledChangeCallbacks.forEach((fn) => fn(isDisabled)),
        );
      },
      {injector},
    );

    // Touched changes
    effect(
      () => {
        const touched = this.field().touched();
        this.emitOnChange('touched', touched, () =>
          (this as any)._events.next(new TouchedChangeEvent(touched, this)),
        );
      },
      {injector},
    );

    // Dirty changes
    effect(
      () => {
        const dirty = this.field().dirty();
        this.emitOnChange('dirty', dirty, () =>
          (this as any)._events.next(new PristineChangeEvent(!dirty, this)),
        );
      },
      {injector},
    );
  }

  /** Emits callback only when value changes from the previous state. */
  private emitOnChange<K extends keyof typeof this.lastState>(
    key: K,
    value: NonNullable<(typeof this.lastState)[K]>,
    callback: (value: NonNullable<(typeof this.lastState)[K]>) => void,
  ): void {
    if (this.lastState[key] === undefined) {
      this.lastState[key] = value;
    } else if (this.lastState[key] !== value) {
      this.lastState[key] = value;
      callback(value);
    }
  }

  // --- Value mutation methods ---

  override setValue(value: any, options?: ValueUpdateOptions): void {
    this.updateValue(value, options);
  }

  override patchValue(value: any, options?: ValueUpdateOptions): void {
    this.updateValue(value, options);
  }

  private updateValue(value: any, options?: ValueUpdateOptions): void {
    const parent = this.prepareParentPropagation(options);
    this.source.set(value);
    if (parent) {
      parent.updateValueAndValidity({emitEvent: options?.emitEvent, sourceControl: this} as any);
    }
    if (options?.emitModelToViewChange !== false) {
      const emitModelEvent = options?.emitViewToModelChange !== false;
      this.onChangeCallbacks.forEach((fn) => fn(value, emitModelEvent));
    }
  }

  override getRawValue(): T {
    return this.value;
  }

  override reset(value?: any, options?: ValueUpdateOptions): void {
    if (value && typeof value === 'object' && 'value' in value && 'disabled' in value) {
      // Unbox the value for reset, ignoring the disabled state as it is driven by rules.
      value = value.value;
    }

    const resetValue = value ?? this.source();
    this.field().reset(resetValue as any);

    if (value !== undefined) {
      this.updateValue(value, options);
    } else if (!options?.onlySelf) {
      this.parent?.updateValueAndValidity({
        emitEvent: options?.emitEvent,
        sourceControl: this,
      } as any);
    }

    if (options?.emitEvent !== false) {
      (this as any)._events.next(new FormResetEvent(this));
    }
  }

  private prepareParentPropagation(options?: ValueUpdateOptions): FormGroup | FormArray | null {
    if (options?.onlySelf) {
      this.pendingParentNotifications++;
      return null;
    }
    if (this.parent) {
      this.pendingParentNotifications++;
      return this.parent;
    }
    return null;
  }

  // --- Callback registration ---

  registerOnChange(fn: (value?: any, emitModelEvent?: boolean) => void): void {
    this.onChangeCallbacks.push(fn);
  }

  _unregisterOnChange(fn: (value?: any, emitModelEvent?: boolean) => void): void {
    removeListItem(this.onChangeCallbacks, fn);
  }

  registerOnDisabledChange(fn: (isDisabled: boolean) => void): void {
    this.onDisabledChangeCallbacks.push(fn);
  }

  _unregisterOnDisabledChange(fn: (isDisabled: boolean) => void): void {
    removeListItem(this.onDisabledChangeCallbacks, fn);
  }

  // --- State getters (delegated to field) ---

  override get status(): FormControlStatus {
    const f = this.field();
    if (f.disabled()) return 'DISABLED';
    if (f.valid()) return 'VALID';
    if (f.invalid()) return 'INVALID';
    return 'PENDING';
  }

  override get dirty(): boolean {
    return this.field().dirty();
  }
  override set dirty(_: boolean) {} // No-op: state is derived from signal

  override get touched(): boolean {
    return this.field().touched();
  }
  override set touched(_: boolean) {} // No-op: state is derived from signal

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
    return !this.disabled;
  }

  // --- State mutation methods ---

  override markAsTouched(opts?: {onlySelf?: boolean}): void {
    this.field().markAsTouched();
    super.markAsTouched(opts);
  }

  override markAsDirty(opts?: {onlySelf?: boolean}): void {
    this.field().markAsDirty();
    super.markAsDirty(opts);
  }

  override markAsPristine(opts?: {onlySelf?: boolean}): void {
    this.field().reset(this.source() as any); // reset() clears pristine internally
    super.markAsPristine(opts);
  }

  override markAsUntouched(opts?: {onlySelf?: boolean}): void {
    this.field().reset(this.source() as any); // reset() clears touched internally
    super.markAsUntouched(opts);
  }

  override updateValueAndValidity(_opts?: Object): void {} // No-op: validity is derived from signal

  // --- Internal methods required by AbstractControl ---

  _updateValue(): void {}
  _forEachChild(_cb: (c: AbstractControl) => void): void {}
  _anyControls(_condition: (c: AbstractControl) => boolean): boolean {
    return false;
  }
  _allControlsDisabled(): boolean {
    return this.disabled;
  }
  _syncPendingControls(): boolean {
    return false;
  }

  // Unsupported methods
  override disable(_opts?: {onlySelf?: boolean; emitEvent?: boolean}): void {
    throw this.unsupported();
  }

  override enable(_opts?: {onlySelf?: boolean; emitEvent?: boolean}): void {
    throw this.unsupported();
  }

  override setValidators(_validators: any): void {
    throw this.unsupported();
  }

  override setAsyncValidators(_validators: any): void {
    throw this.unsupported();
  }

  override addValidators(_validators: any): void {
    throw this.unsupported();
  }

  override addAsyncValidators(_validators: any): void {
    throw this.unsupported();
  }

  override removeValidators(_validators: any): void {
    throw this.unsupported();
  }

  override removeAsyncValidators(_validators: any): void {
    throw this.unsupported();
  }

  override clearValidators(): void {
    throw this.unsupported();
  }

  override clearAsyncValidators(): void {
    throw this.unsupported();
  }

  override setErrors(_errors: any, _opts?: {emitEvent?: boolean}): void {
    throw this.unsupported();
  }

  override markAsPending(_opts?: {onlySelf?: boolean; emitEvent?: boolean}): void {
    throw this.unsupported();
  }

  private unsupported() {
    return new RuntimeError(
      SignalFormsErrorCode.UNSUPPORTED_FEATURE,
      ngDevMode && 'this feature is not supported in SignalFormControl',
    );
  }
}

export function SignalFormControlFactory<T>(
  source: WritableSignal<T>,
  schema: SchemaFn<T> | undefined,
  injector: Injector,
): SignalFormControl<T> {
  return new SignalFormControl(source, injector, schema);
}

/** Wraps FieldState.value to trigger synchronous parent notification on set/update. */
function wrapFieldStateForSyncUpdates<T>(
  state: FieldState<T>,
  onUpdate: () => void,
): FieldState<T> {
  const {value} = state;
  return {
    ...state,
    value: Object.assign(() => value(), {
      set: (v: T) => (value.set(v), onUpdate()),
      update: (fn: (v: T) => T) => (value.update(fn), onUpdate()),
    }) as WritableSignal<T>,
  };
}
