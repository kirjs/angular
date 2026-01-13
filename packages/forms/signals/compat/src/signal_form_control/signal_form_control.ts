/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  EventEmitter,
  inject,
  Injector,
  signal,
  WritableSignal,
  effect,
  ɵRuntimeError as RuntimeError,
} from '@angular/core';
import {
  AbstractControl,
  ControlEvent,
  FormArray,
  FormControlStatus,
  FormGroup,
  PristineChangeEvent,
  StatusChangeEvent,
  TouchedChangeEvent,
  ValueChangeEvent,
  FormResetEvent,
  FormControlState,
} from '@angular/forms';

import {compatForm} from '../api/compat_form';
import {signalErrorsToValidationErrors} from '../../../src/api/rules';
import {FormOptions} from '../../../src/api/structure';
import {FieldState, FieldTree, SchemaFn} from '../../../src/api/types';
import {SignalFormsErrorCode} from '../../../src/errors';
import {normalizeFormArgs} from '../../../src/util/normalize_form_args';
import {removeListItem} from '../../../../src/util';

/** Options used to update the control value. */
export type ValueUpdateOptions = {
  onlySelf?: boolean;
  emitEvent?: boolean;
  emitModelToViewChange?: boolean;
  emitViewToModelChange?: boolean;
};

/**
 * A `FormControl` that is backed by signal forms rules.
 *
 * This class provides a bridge between Signal Forms and Reactive Forms, allowing
 * signal-based controls to be used within a standard `FormGroup` or `FormArray`.
 *
 * @experimental
 */
export class SignalFormControl<T> extends AbstractControl {
  /** Source FieldTree. */
  public fieldTree: FieldTree<T>;
  /** The raw signal driving the control value. */
  public source: WritableSignal<T>;

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

  /**
   * @param value The initial value for the control.
   * @param schemaOrOptions The schema for the control, or the control options.
   * @param options The control options.
   */
  constructor(value: T, schemaOrOptions?: SchemaFn<T> | FormOptions, options?: FormOptions) {
    super(null, null);

    const [model, schema, opts] = normalizeFormArgs<T>([signal(value), schemaOrOptions, options]);
    this.source = model;
    const injector = opts?.injector ?? inject(Injector);

    const rawTree = schema
      ? compatForm(this.source, schema, {injector})
      : compatForm(this.source, {injector});
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
        this.emitControlEvent(new ValueChangeEvent(value, this));
      },
      {injector},
    );

    // Status and disabled changes
    effect(
      () => {
        const status = this.status;
        this.statusChanges.emit(status);
        this.emitOnChange('status', status, () =>
          this.emitControlEvent(new StatusChangeEvent(status, this)),
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
          this.emitControlEvent(new TouchedChangeEvent(touched, this)),
        );
      },
      {injector},
    );

    // Dirty changes
    effect(
      () => {
        const dirty = this.fieldTree().dirty();
        this.emitOnChange('dirty', dirty, () =>
          this.emitControlEvent(new PristineChangeEvent(!dirty, this)),
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

  override reset(value?: T | FormControlState<T>, options?: ValueUpdateOptions): void {
    if (isFormControlState(value)) {
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
      this.emitControlEvent(new FormResetEvent(this));
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
    throw unsupportedDisableEnableError();
  }

  override enable(_opts?: {onlySelf?: boolean; emitEvent?: boolean}): void {
    throw unsupportedDisableEnableError();
  }

  override setValidators(_validators: any): void {
    throw unsupportedValidatorsError();
  }

  override setAsyncValidators(_validators: any): void {
    throw unsupportedValidatorsError();
  }

  override addValidators(_validators: any): void {
    throw unsupportedValidatorsError();
  }

  override addAsyncValidators(_validators: any): void {
    throw unsupportedValidatorsError();
  }

  override removeValidators(_validators: any): void {
    throw unsupportedValidatorsError();
  }

  override removeAsyncValidators(_validators: any): void {
    throw unsupportedValidatorsError();
  }

  override clearValidators(): void {
    throw unsupportedValidatorsError();
  }

  override clearAsyncValidators(): void {
    throw unsupportedValidatorsError();
  }

  override setErrors(_errors: any, _opts?: {emitEvent?: boolean}): void {
    throw unsupportedFeatureError(
      'Imperatively setting errors is not supported in signal forms. Errors are derived from validation rules.',
    );
  }

  override markAsPending(_opts?: {onlySelf?: boolean; emitEvent?: boolean}): void {
    throw unsupportedFeatureError(
      'Imperatively marking as pending is not supported in signal forms. Pending state is derived from async validation status.',
    );
  }

  private emitControlEvent(event: ControlEvent): void {
    (this as any)._events.next(event);
  }
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
    set: (v: T) => {
      value.set(v);
      onUpdate();
    },
    update: (fn: (v: T) => T) => {
      value.update(fn);
      onUpdate();
    },
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

function isFormControlState(formState: unknown): formState is {value: any; disabled: boolean} {
  return (
    typeof formState === 'object' &&
    formState !== null &&
    Object.keys(formState).length === 2 &&
    'value' in formState &&
    'disabled' in formState
  );
}

function unsupportedFeatureError(message: string): RuntimeError {
  return new RuntimeError(SignalFormsErrorCode.UNSUPPORTED_FEATURE as any, ngDevMode && message);
}

function unsupportedDisableEnableError(): RuntimeError {
  return unsupportedFeatureError(
    'Imperatively changing enabled/disabled status in form control is not supported in signal forms. Instead use a "disabled" rule to derive the disabled status from a signal.',
  );
}

function unsupportedValidatorsError(): RuntimeError {
  return unsupportedFeatureError(
    'Dynamically adding and removing validators is not supported in signal forms. Instead use the "applyWhen" rule to conditionally apply validators based on a signal.',
  );
}
