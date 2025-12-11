/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {Component, Injector, inject, provideZonelessChangeDetection, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {FormControl, ReactiveFormsModule} from '@angular/forms';
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
});

function act<T>(fn: () => T): T {
  try {
    return fn();
  } finally {
    TestBed.tick();
  }
}
