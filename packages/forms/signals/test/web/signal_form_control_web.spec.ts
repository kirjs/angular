/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {Component, Injector, inject, provideZonelessChangeDetection, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {FormControl, FormGroup, ReactiveFormsModule} from '@angular/forms';
import {SignalFormControlFactory} from '../../compat/src/signal_form_control/signal_form_control';

describe('SignalFormControl (web)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
      imports: [ReactiveFormsModule],
    });
  });

  it('binds to formControl directive', () => {
    @Component({
      standalone: true,
      imports: [ReactiveFormsModule],
      template: `<input [formControl]="control" />`,
    })
    class TestCmp {
      readonly model = signal('initial');
      readonly control = SignalFormControlFactory(
        this.model,
        undefined,
        inject(Injector),
      ) as unknown as FormControl;
    }

    const fixture = act(() => TestBed.createComponent(TestCmp));
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');

    // Model -> View
    expect(input.value).toBe('initial');
    act(() => fixture.componentInstance.control.setValue('changed'));
    expect(input.value).toBe('changed');

    // View -> Model
    act(() => {
      input.value = 'view';
      input.dispatchEvent(new Event('input'));
    });
    expect(fixture.componentInstance.model()).toBe('view');
  });

  it('binds inside nested FormGroup via formGroupName', () => {
    @Component({
      standalone: true,
      imports: [ReactiveFormsModule],
      template: `
        <form [formGroup]="form">
          <div formGroupName="user">
            <input formControlName="name" />
          </div>
        </form>
      `,
    })
    class TestCmp {
      private readonly injector = inject(Injector);
      readonly model = signal('start');
      readonly control = SignalFormControlFactory(
        this.model,
        undefined,
        this.injector,
      ) as unknown as FormControl;
      readonly form = new FormGroup({
        user: new FormGroup({
          name: this.control,
        }),
      });
    }

    const fixture = act(() => TestBed.createComponent(TestCmp));
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    const form = fixture.componentInstance.form;
    const control = form.get(['user', 'name']) as FormControl;

    // Model -> View through form group structure.
    expect(input.value).toBe('start');
    expect(form.value).toEqual({user: {name: 'start'}});
    act(() => fixture.componentInstance.control.setValue('group-change'));
    expect(input.value).toBe('group-change');
    expect(form.value).toEqual({user: {name: 'group-change'}});

    // View -> Model updates propagate back to signal.
    act(() => {
      input.value = 'typed';
      input.dispatchEvent(new Event('input'));
    });
    expect(fixture.componentInstance.model()).toBe('typed');
    expect(form.value).toEqual({user: {name: 'typed'}});
    expect(control.dirty).toBeTrue();
    expect(form.dirty).toBeTrue();

    // Touched state flows through blur.
    expect(control.touched).toBeFalse();
    expect(form.touched).toBeFalse();
    act(() => input.dispatchEvent(new Event('blur')));
    expect(control.touched).toBeTrue();
    expect(form.touched).toBeTrue();

    // Form-level updates propagate to the input.
    act(() => form.patchValue({user: {name: 'group-form'}}));
    expect(input.value).toBe('group-form');
    expect(control.value).toBe('group-form');
    expect(fixture.componentInstance.model()).toBe('group-form');
  });
});

function act<T>(fn: () => T): T {
  try {
    return fn();
  } finally {
    TestBed.tick();
  }
}
