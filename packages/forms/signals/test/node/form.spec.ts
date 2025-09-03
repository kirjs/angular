/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {inject, Injector, runInInjectionContext, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {Field, form, required, schema, validate} from '../../public_api';
import {FormControl} from '@angular/forms';

describe('form', () => {
  describe('injection context', () => {
    it('throws when there is no injection context', () => {
      const model = signal(123);
      expect(() => form(model)).toThrowError();
    });

    it('is not present in rules', () => {
      const injector = TestBed.inject(Injector);

      const model = signal(123);
      const f = form(
        model,
        (p) => {
          validate(p, () => {
            expect(() => {
              inject(Injector);
            }).toThrow();
            return undefined;
          });
        },
        {injector},
      );

      // Make sure the validation runs
      f().valid();
    });

    it('uses provided provided injection context to run the form', () => {
      const injector = TestBed.inject(Injector);

      const model = signal(123);
      form(
        model,
        () => {
          expect(inject(Injector)).toBe(injector);
        },
        {injector},
      );
    });

    it('TBD spec', () => {
      const injector = TestBed.inject(Injector);

      const formControl = new FormControl('123', {nonNullable: true});
      const model = signal({a: formControl, b: 3});
      const f = form(
        model,
        (p) => {
          validate(p.a, ({value, valueOf, stateOf}) => {
            // Value works
            expect(value()).toEqual('123');
            // Value of works
            expect(valueOf(p.a)).toEqual('123');
            expect(stateOf(p.a).value()).toEqual('123');
          });
        },
        {injector},
      );

      const a = f.a();

      // We can get and set value
      expect(a.value()).toEqual('123');
      a.value.set('333');
      expect(a.value()).toEqual('333');

      // We can get control only for fields with FormControl
      expect(a.control).toEqual(formControl);
      // @ts-expect-error
      expect(f.b().control).toEqual(formControl);

      const setValue = <T>(field: Field<T>, value: T) => {
        // We can't do this anymore
        // @ts-expect-error
        field().value.set(value);

        // @ts-expect-error
        field().value.set(field().value());
      };
    });

    it('uses provided provided injection context over the one it is run in', () => {
      const injector = TestBed.inject(Injector);
      const injector2 = Injector.create({providers: [], parent: injector});

      const model = signal(123);

      runInInjectionContext(injector2, () => {
        form(
          model,
          () => {
            expect(inject(Injector)).toBe(injector);
          },
          {injector: injector},
        );
      });
    });
  });

  it('should infer schema type', () => {
    runInInjectionContext(TestBed.inject(Injector), () => {
      const f = form(
        signal<{x: string}>({x: ''}),
        schema((p) => {
          // Note: the primary purpose of this test is to verify that the line below does not have
          // a type error due to `p` being of type `unknown`.
          required(p.x);
        }),
      );
      expect(f.x().valid()).toBe(false);
    });
  });
});
