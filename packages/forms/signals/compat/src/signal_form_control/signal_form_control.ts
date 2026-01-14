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
  public readonly fieldTree: FieldTree<T>;
  /** The raw signal driving the control value. */
  public readonly source: WritableSignal<T>;

  private readonly fieldState: FieldState<T>;
  private pendingParentNotifications = 0;
  private readonly onChangeCallbacks: Array<(value?: any, emitModelEvent?: boolean) => void> = [];
  private readonly onDisabledChangeCallbacks: Array<(isDisabled: boolean) => void> = [];
  override readonly valueChanges = new EventEmitter<T>();
  override readonly statusChanges = new EventEmitter<FormControlStatus>();

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
    this.fieldState = this.fieldTree();

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
        return signalErrorsToValidationErrors(this.fieldState.errors());
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
        this.notifyParentUnlessPending();
        this.valueChanges.emit(value);
        this.emitControlEvent(new ValueChangeEvent(value, this));
      },
      {injector},
    );

    // Status changes
    effect(
      () => {
        const status = this.status;
        this.statusChanges.emit(status);
        this.emitControlEvent(new StatusChangeEvent(status, this));
      },
      {injector},
    );

    // Disabled changes
    effect(
      () => {
        const isDisabled = this.disabled;
        for (const fn of this.onDisabledChangeCallbacks) {
          fn(isDisabled);
        }
      },
      {injector},
    );

    // Touched changes
    effect(
      () => {
        const isTouched = this.fieldState.touched();
        this.emitControlEvent(new TouchedChangeEvent(isTouched, this));
        const parent = this.parent;
        if (!parent) {
          return;
        }
        if (!isTouched) {
          parent.markAsUntouched();
        } else {
          parent.markAsTouched();
        }
      },
      {injector},
    );

    // Dirty changes
    effect(
      () => {
        const isDirty = this.fieldState.dirty();
        this.emitControlEvent(new PristineChangeEvent(!isDirty, this));
        const parent = this.parent;
        if (!parent) {
          return;
        }
        if (isDirty) {
          parent.markAsDirty();
        } else {
          parent.markAsPristine();
        }
      },
      {injector},
    );
  }

  // Values

  override setValue(value: any, options?: ValueUpdateOptions): void {
    this.updateValue(value, options);
  }

  override patchValue(value: any, options?: ValueUpdateOptions): void {
    this.updateValue(value, options);
  }

  private updateValue(value: any, options?: ValueUpdateOptions): void {
    const parent = this.scheduleParentUpdate(options);
    this.source.set(value);
    if (parent) {
      this.updateParentValueAndValidity(parent, options?.emitEvent);
    }
    if (options?.emitModelToViewChange !== false) {
      const emitModelEvent = options?.emitViewToModelChange !== false;
      for (const fn of this.onChangeCallbacks) {
        fn(value, emitModelEvent);
      }
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
    this.fieldState.reset(resetValue as any);

    if (value !== undefined) {
      this.updateValue(value, options);
    } else if (!options?.onlySelf) {
      const parent = this.parent;
      if (parent) {
        this.updateParentValueAndValidity(parent, options?.emitEvent);
      }
    }

    if (options?.emitEvent !== false) {
      this.emitControlEvent(new FormResetEvent(this));
    }
  }

  private scheduleParentUpdate(options?: ValueUpdateOptions): FormGroup | FormArray | null {
    if (options?.onlySelf) {
      this.pendingParentNotifications++;
      return null;
    }
    const parent = this.parent;
    if (!parent) {
      return null;
    }
    this.pendingParentNotifications++;
    return parent;
  }

  private notifyParentUnlessPending(): void {
    if (this.pendingParentNotifications > 0) {
      this.pendingParentNotifications--;
      return;
    }
    const parent = this.parent;
    if (parent) {
      this.updateParentValueAndValidity(parent);
    }
  }

  private updateParentValueAndValidity(parent: AbstractControl, emitEvent?: boolean): void {
    parent.updateValueAndValidity({emitEvent, sourceControl: this} as any);
  }

  private propagateToParent(
    opts: {onlySelf?: boolean} | undefined,
    fn: (parent: AbstractControl) => void,
  ) {
    const parent = this.parent;
    if (parent && !opts?.onlySelf) {
      fn(parent);
    }
  }

  // Callbacks

  registerOnChange(fn: (value?: any, emitModelEvent?: boolean) => void): void {
    this.onChangeCallbacks.push(fn);
  }

  /** @internal */
  _unregisterOnChange(fn: (value?: any, emitModelEvent?: boolean) => void): void {
    removeListItem(this.onChangeCallbacks, fn);
  }

  registerOnDisabledChange(fn: (isDisabled: boolean) => void): void {
    this.onDisabledChangeCallbacks.push(fn);
  }

  /** @internal */
  _unregisterOnDisabledChange(fn: (isDisabled: boolean) => void): void {
    removeListItem(this.onDisabledChangeCallbacks, fn);
  }

  override get status(): FormControlStatus {
    const f = this.fieldState;
    if (f.disabled()) {
      return 'DISABLED';
    }
    if (f.valid()) {
      return 'VALID';
    }
    if (f.invalid()) {
      return 'INVALID';
    }
    return 'PENDING';
  }

  override get dirty(): boolean {
    return this.fieldState.dirty();
  }

  override set dirty(_: boolean) {} // No-op: state is derived from signal

  override get pristine(): boolean {
    return !this.dirty;
  }

  override set pristine(_: boolean) {} // No-op: state is derived from signal

  override get touched(): boolean {
    return this.fieldState.touched();
  }

  override set touched(_: boolean) {} // No-op: state is derived from signal

  override get untouched(): boolean {
    return !this.touched;
  }

  override set untouched(_: boolean) {} // No-op: state is derived from signal

  override get valid(): boolean {
    return this.fieldState.valid();
  }

  override get invalid(): boolean {
    return this.fieldState.invalid();
  }

  override get pending(): boolean {
    return this.fieldState.pending();
  }

  override get disabled(): boolean {
    return this.fieldState.disabled();
  }

  override get enabled(): boolean {
    return !this.disabled;
  }

  override markAsTouched(opts?: {onlySelf?: boolean}): void {
    this.fieldState.markAsTouched();
    this.propagateToParent(opts, (parent) => parent.markAsTouched(opts));
  }

  override markAsDirty(opts?: {onlySelf?: boolean}): void {
    this.fieldState.markAsDirty();
    this.propagateToParent(opts, (parent) => parent.markAsDirty(opts));
  }

  override markAsPristine(opts?: {onlySelf?: boolean}): void {
    this.fieldState.reset(this.source() as any); // reset() clears pristine internally
    this.propagateToParent(opts, (parent) => parent.markAsPristine(opts));
  }

  override markAsUntouched(opts?: {onlySelf?: boolean}): void {
    this.fieldState.reset(this.source() as any); // reset() clears touched internally
    this.propagateToParent(opts, (parent) => parent.markAsUntouched(opts));
  }

  override updateValueAndValidity(_opts?: Object): void {} // No-op: validity is derived from signal

  /** @internal */
  _updateValue(): void {}

  /** @internal */
  _forEachChild(_cb: (c: AbstractControl) => void): void {}

  /** @internal */
  _anyControls(_condition: (c: AbstractControl) => boolean): boolean {
    return false;
  }

  /** @internal */
  _allControlsDisabled(): boolean {
    return this.disabled;
  }

  /** @internal */
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

function wrapFieldTreeForSyncUpdates<T>(tree: FieldTree<T>, onUpdate: () => void): FieldTree<T> {
  const treeCache = new WeakMap<object, object>();
  const stateCache = new WeakMap<object, object>();

  const wrapTree = (t: object): object => {
    const cached = treeCache.get(t);
    if (cached) {
      return cached;
    }
    const wrapped = new Proxy(t, {
      get(target, prop) {
        const val = (target as any)[prop];
        if (typeof val === 'function' && typeof prop === 'string') {
          return wrapTree(val);
        }
        return val;
      },
      apply(target, _, args) {
        const state = (target as Function)(...args);
        const cachedState = stateCache.get(state);
        if (cachedState) {
          return cachedState;
        }
        const {value} = state;
        const wrappedValue = Object.assign((...a: any[]) => value(...a), {
          set: (v: T) => {
            value.set(v);
            onUpdate();
          },
          update: (fn: (v: T) => T) => {
            value.update(fn);
            onUpdate();
          },
        }) as WritableSignal<any>;
        const wrappedState = Object.create(state, {value: {get: () => wrappedValue}});
        stateCache.set(state, wrappedState);
        return wrappedState;
      },
    });
    treeCache.set(t, wrapped);
    return wrapped;
  };

  return wrapTree(tree) as any;
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
