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
import {Field} from '@angular/forms/signals';
import {SignalFormControl} from '../../compat/src/signal_form_control/signal_form_control';

describe('SignalFormControl (web)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
      imports: [ReactiveFormsModule, Field],
    });
  });

  it('binds to formControl directive', () => {
    @Component({
      standalone: true,
      imports: [ReactiveFormsModule, Field],
      template: `<input [field]="signalControl.fieldTree" />`,
    })
    class TestCmp {
      readonly signalControl = new SignalFormControl('initial', undefined, {
        injector: inject(Injector),
      });
      readonly control = this.signalControl as unknown as FormControl;
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
    expect(fixture.componentInstance.signalControl.source()).toBe('view');
  });

  it('binds inside nested FormGroup via formGroupName', () => {
    @Component({
      standalone: true,
      imports: [ReactiveFormsModule, Field],
      template: `
        <div [formGroup]="group">
          <div formGroupName="inner">
            <input [field]="signalControl.fieldTree" />
          </div>
        </div>
      `,
    })
    class TestCmp {
      readonly signalControl = new SignalFormControl('initial', undefined, {
        injector: inject(Injector),
      });
      readonly control = this.signalControl as unknown as FormControl;
      readonly group = new FormGroup({
        inner: new FormGroup({
          control: this.control,
        }),
      });
    }

    const fixture = act(() => TestBed.createComponent(TestCmp));
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');

    expect(input.value).toBe('initial');
    expect(fixture.componentInstance.group.dirty).toBe(false);

    act(() => {
      input.value = 'updated';
      input.dispatchEvent(new Event('input'));
    });

    expect(fixture.componentInstance.signalControl.source()).toBe('updated');
    expect(fixture.componentInstance.group.dirty).toBe(true);
  });
});

function act<T>(fn: () => T): T {
  try {
    return fn();
  } finally {
    TestBed.tick();
  }
}
