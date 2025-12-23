/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {EventEmitter, Injector, WritableSignal, effect} from '@angular/core';
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
} from '@angular/forms';

import {compatForm} from '../api/compat_form';
import {SchemaFn} from '../../../src/api/types';
import {removeListItem} from '../../../../src/util';

export type ValueUpdateOptions = {
  onlySelf?: boolean;
  emitEvent?: boolean;
  emitModelToViewChange?: boolean;
  emitViewToModelChange?: boolean;
};

export class SignalFormControl<T> extends AbstractControl {
  private field;
  private pendingParentNotifications = 0;
  private onChangeCallbacks: Array<(value?: any, emitModelEvent?: boolean) => void> = [];
  private onDisabledChangeCallbacks: Array<(isDisabled: boolean) => void> = [];
  private lastDisabledState: boolean | undefined;
  private lastTouchedState: boolean | undefined;
  private lastDirtyState: boolean | undefined;
  private lastStatusState: FormControlStatus | undefined;

  constructor(
    public source: WritableSignal<T>,
    injector: Injector,
    schema?: SchemaFn<T>,
  ) {
    super(null, null);

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
        const result: ValidationErrors = {};
        for (const error of errors) {
          result[error.kind] = error;
        }
        return result;
      },
      enumerable: true,
      configurable: true,
    });

    (this as unknown as {valueChanges: EventEmitter<any>}).valueChanges = new EventEmitter();
    (this as unknown as {statusChanges: EventEmitter<any>}).statusChanges = new EventEmitter();

    effect(
      () => {
        const currentValue = this.source();

        if (this.pendingParentNotifications > 0) {
          this.pendingParentNotifications--;
        } else {
          this.parent?.updateValueAndValidity({sourceControl: this} as any);
        }

        (this.valueChanges as EventEmitter<T>).emit(currentValue);
        (this as any)._events.next(new ValueChangeEvent(currentValue, this));
      },
      {injector},
    );
    effect(
      () => {
        const status = this.status;
        (this.statusChanges as EventEmitter<FormControlStatus>).emit(status);

        // Emit StatusChangeEvent only on actual status changes
        if (this.lastStatusState === undefined) {
          this.lastStatusState = status;
        } else if (this.lastStatusState !== status) {
          this.lastStatusState = status;
          (this as any)._events.next(new StatusChangeEvent(status, this));
        }

        const isDisabled = this.disabled;
        if (this.lastDisabledState === undefined) {
          this.lastDisabledState = isDisabled;
        } else if (this.lastDisabledState !== isDisabled) {
          this.lastDisabledState = isDisabled;
          this.onDisabledChangeCallbacks.forEach((fn) => fn(isDisabled));
        }
      },
      {injector},
    );
    effect(
      () => {
        const touched = this.field().touched();
        if (this.lastTouchedState === undefined) {
          this.lastTouchedState = touched;
        } else if (this.lastTouchedState !== touched) {
          this.lastTouchedState = touched;
          (this as any)._events.next(new TouchedChangeEvent(touched, this));
        }
      },
      {injector},
    );
    effect(
      () => {
        const dirty = this.field().dirty();
        if (this.lastDirtyState === undefined) {
          this.lastDirtyState = dirty;
        } else if (this.lastDirtyState !== dirty) {
          this.lastDirtyState = dirty;
          (this as any)._events.next(new PristineChangeEvent(!dirty, this));
        }
      },
      {injector},
    );
  }

  override setValue(value: any, options?: ValueUpdateOptions): void {
    const parent = this.prepareParentPropagation(options);
    this.source.set(value);
    this.notifyParent(parent, options);
    this.emitModelChanges(value, options);
  }

  override patchValue(value: any, options?: ValueUpdateOptions): void {
    const parent = this.prepareParentPropagation(options);
    this.source.set(value);
    this.notifyParent(parent, options);
    this.emitModelChanges(value, options);
  }

  override reset(value?: any, options?: ValueUpdateOptions): void {
    // Reset the underlying field state (touched/dirty) using the field's reset method
    this.field().reset(value !== undefined ? value : (this.source() as any));

    if (value !== undefined) {
      const parent = this.prepareParentPropagation(options);
      this.source.set(value);
      this.notifyParent(parent, options);
      this.emitModelChanges(value, options);
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

  private emitModelChanges(value: any, options?: ValueUpdateOptions): void {
    if (options?.emitModelToViewChange === false) return;
    const emitModelEvent = options?.emitViewToModelChange !== false;
    this.onChangeCallbacks.forEach((fn) => fn(value, emitModelEvent));
  }

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

  override updateValueAndValidity(opts?: Object): void {}

  override get status(): FormControlStatus {
    if (this.field().disabled()) return 'DISABLED';
    if (this.field().valid()) return 'VALID';
    if (this.field().invalid()) return 'INVALID';
    return 'PENDING';
  }

  override get dirty(): boolean {
    return this.field().dirty();
  }
  override set dirty(_: boolean) {}

  override get touched(): boolean {
    return this.field().touched();
  }
  override set touched(_: boolean) {}

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
    super.markAsTouched(opts);
  }

  override markAsDirty(opts?: {onlySelf?: boolean}): void {
    this.field().markAsDirty();
    super.markAsDirty(opts);
  }

  override markAsPristine(opts?: {onlySelf?: boolean}): void {
    // FieldState doesn't expose markAsPristine directly, but reset() calls it internally.
    // We call reset() with the current value to avoid changing it.
    this.field().reset(this.source() as any);
    super.markAsPristine(opts);
  }

  override markAsUntouched(opts?: {onlySelf?: boolean}): void {
    // FieldState doesn't expose markAsUntouched directly, but reset() calls it internally.
    // We call reset() with the current value to avoid changing it.
    this.field().reset(this.source() as any);
    super.markAsUntouched(opts);
  }

  // @internal
  _updateValue(): void {}

  // @internal
  _forEachChild(cb: (c: AbstractControl) => void): void {}

  // @internal
  _anyControls(condition: (c: AbstractControl) => boolean): boolean {
    return false;
  }

  // @internal
  _allControlsDisabled(): boolean {
    return this.disabled;
  }

  // @internal
  _syncPendingControls(): boolean {
    return false;
  }
}

export function SignalFormControlFactory<T>(
  source: WritableSignal<T>,
  schema: SchemaFn<T> | undefined,
  injector: Injector,
): SignalFormControl<T> {
  return new SignalFormControl(source, injector, schema);
}
