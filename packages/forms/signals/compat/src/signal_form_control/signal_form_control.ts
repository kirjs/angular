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
import {signalErrorsToValidationErrors} from '../../../src/api/rules/validation/validation_errors';
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
  public fieldTree: FieldTree<T>;
  private pendingParentNotifications = 0;
  private readonly onChangeCallbacks: Array<(value?: any, emitModelEvent?: boolean) => void> = [];
  private readonly onDisabledChangeCallbacks: Array<(isDisabled: boolean) => void> = [];
  override readonly valueChanges = new EventEmitter<T>();
  override readonly statusChanges = new EventEmitter<FormControlStatus>();

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

    const rawTree = schema
      ? compatForm(source, schema, {injector})
      : compatForm(source, {injector});
    this.fieldTree = wrapFieldTreeForSyncUpdates(rawTree, () =>
      this.parent?.updateValueAndValidity({sourceControl: this} as any),
    );

    // Define value and errors as getters (Object.defineProperty is needed because
    // AbstractControl declares them as properties, and TypeScript doesn't allow
    // overriding a property with a getter).
    Object.defineProperty(this, 'value', {
      get: () => this.source(),
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(this, 'errors', {
      get: () => {
        return signalErrorsToValidationErrors(this.fieldTree().errors());
      },
      enumerable: true,
      configurable: true,
    });

    this.setupEffects(injector);
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
        this.valueChanges.emit(value);
        (this as any)._events.next(new ValueChangeEvent(value, this));
      },
      {injector},
    );

    // Status and disabled changes
    effect(
      () => {
        const status = this.status;
        this.statusChanges.emit(status);
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
        const touched = this.fieldTree().touched();
        this.emitOnChange('touched', touched, () =>
          (this as any)._events.next(new TouchedChangeEvent(touched, this)),
        );
      },
      {injector},
    );

    // Dirty changes
    effect(
      () => {
        const dirty = this.fieldTree().dirty();
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
    this.fieldTree().reset(resetValue as any);

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
    const f = this.fieldTree();
    if (f.disabled()) return 'DISABLED';
    if (f.valid()) return 'VALID';
    if (f.invalid()) return 'INVALID';
    return 'PENDING';
  }

  override get dirty(): boolean {
    return this.fieldTree().dirty();
  }

  override set dirty(_: boolean) {} // No-op: state is derived from signal

  override get touched(): boolean {
    return this.fieldTree().touched();
  }

  override set touched(_: boolean) {} // No-op: state is derived from signal

  override get valid(): boolean {
    return this.fieldTree().valid();
  }

  override get invalid(): boolean {
    return this.fieldTree().invalid();
  }

  override get pending(): boolean {
    return this.fieldTree().pending();
  }

  override get disabled(): boolean {
    return this.fieldTree().disabled();
  }

  override get enabled(): boolean {
    return !this.disabled;
  }

  // --- State mutation methods ---

  override markAsTouched(opts?: {onlySelf?: boolean}): void {
    this.fieldTree().markAsTouched();
    super.markAsTouched(opts);
  }

  override markAsDirty(opts?: {onlySelf?: boolean}): void {
    this.fieldTree().markAsDirty();
    super.markAsDirty(opts);
  }

  override markAsPristine(opts?: {onlySelf?: boolean}): void {
    this.fieldTree().reset(this.source() as any); // reset() clears pristine internally
    super.markAsPristine(opts);
  }

  override markAsUntouched(opts?: {onlySelf?: boolean}): void {
    this.fieldTree().reset(this.source() as any); // reset() clears touched internally
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
    throw this.unsupported(
      'Imperatively changing enabled/disabled status in form control is not supported in signal forms, instead use a disabled (+TODO link) rule',
    );
  }

  override enable(_opts?: {onlySelf?: boolean; emitEvent?: boolean}): void {
    throw this.unsupported(
      'Imperatively changing enabled/disabled status in form control is not supported in signal forms, instead use a disabled (+TODO link) rule',
    );
  }

  override setValidators(_validators: any): void {
    throw this.unsupportedValidators();
  }

  override setAsyncValidators(_validators: any): void {
    throw this.unsupportedValidators();
  }

  override addValidators(_validators: any): void {
    throw this.unsupportedValidators();
  }

  override addAsyncValidators(_validators: any): void {
    throw this.unsupportedValidators();
  }

  override removeValidators(_validators: any): void {
    throw this.unsupportedValidators();
  }

  override removeAsyncValidators(_validators: any): void {
    throw this.unsupportedValidators();
  }

  override clearValidators(): void {
    throw this.unsupportedValidators();
  }

  override clearAsyncValidators(): void {
    throw this.unsupportedValidators();
  }

  override setErrors(_errors: any, _opts?: {emitEvent?: boolean}): void {
    throw this.unsupported();
  }

  override markAsPending(_opts?: {onlySelf?: boolean; emitEvent?: boolean}): void {
    throw this.unsupported();
  }

  private unsupported(message?: string) {
    return new RuntimeError(
      SignalFormsErrorCode.UNSUPPORTED_FEATURE,
      ngDevMode && (message ?? 'this feature is not supported in SignalFormControl'),
    );
  }

  private unsupportedValidators() {
    return this.unsupported(
      'Dynamically adding and removing validators is not supported in signal forms. Instead use applyWhen (TODO link) rule.',
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

/** Wraps FieldTree to trigger synchronous parent notification on field updates. */
function wrapFieldTreeForSyncUpdates<T>(tree: FieldTree<T>, onUpdate: () => void): FieldTree<T> {
  return new Proxy(tree, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (
        typeof value === 'function' &&
        typeof prop === 'string' &&
        !['apply', 'call', 'bind', 'constructor'].includes(prop) &&
        prop !== 'Symbol(Symbol.iterator)'
      ) {
        return wrapFieldTreeForSyncUpdates(value as any, onUpdate);
      }
      return value;
    },
    apply(target, thisArg, argArray) {
      const state = Reflect.apply(target as Function, thisArg, argArray);
      return wrapFieldStateForSyncUpdates(state, onUpdate);
    },
  }) as any;
}

/** Wraps FieldState.value to trigger synchronous parent notification on set/update. */
function wrapFieldStateForSyncUpdates<T>(
  state: FieldState<T>,
  onUpdate: () => void,
): FieldState<T> {
  const {value} = state;
  const wrappedValue = Object.assign((...args: any[]) => (value as any)(...args), {
    set: (v: T) => (value.set(v), onUpdate()),
    update: (fn: (v: T) => T) => (value.update(fn), onUpdate()),
  }) as WritableSignal<any>;

  return new Proxy(state, {
    get(target, prop, receiver) {
      if (prop === 'value') {
        return wrappedValue;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
