import {AbstractControl, FormControl, ValidationErrors, Validators} from '@angular/forms';
import {form, min} from '@angular/forms/experimental';
import {
  convertOldValidatorToNewOne,
  importMinValidator,
} from '@angular/forms/experimental/src/api/compat/importMinValidator';
import {Injector, runInInjectionContext, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {emailValidator} from '@angular/forms/src/validators';

const CAT_REGEX = /^meow$/;

/** Validator function for web hook URL field */
export function catValidator(control: AbstractControl): ValidationErrors | null {
  if (!control.value) {
    return {'required': true};
  }
  if (control.dirty) {
    return Validators.pattern(CAT_REGEX)(control);
  }
  return null;
}

fdescribe('min', () => {
  describe('old to new', () => {
    it('should not error on an empty string', () => {
      const cat = signal({name: 'pirojok-the-cat', age: 5});
      const f = form(
        cat,
        (p) => {
          convertOldValidatorToNewOne(p.age, Validators.min(10));
        },
        {injector: TestBed.inject(Injector)},
      );

      expect(f.age().errors()).toEqual([{kind: 'min'}]);
      f.age().value.set(15);
      expect(f.age().errors()).toEqual([]);
    });

    it('validator required', () => {
      const cat = signal({name: '', age: 5});
      const f = form(
        cat,
        (p) => {
          convertOldValidatorToNewOne(p.name, Validators.required);
        },
        {injector: TestBed.inject(Injector)},
      );

      expect(f.name().errors()).toEqual([{kind: 'required'}]);
      f.name().value.set('pirojok-the-cat');
      expect(f.name().errors()).toEqual([]);
    });
  });
  describe('new to old', () => {
    let convertedMin: any;
    beforeEach(() => {
      runInInjectionContext(TestBed.inject(Injector), () => {
        convertedMin = importMinValidator(min);
      });
    });

    it('should not error on an empty string', () => {
      expect(convertedMin(2)(new FormControl(''))).toBeNull();
    });

    it('should not error on null', () => {
      expect(convertedMin(2)(new FormControl(null))).toBeNull();
    });

    it('should not error on undefined', () => {
      expect(convertedMin(2)(new FormControl(undefined))).toBeNull();
    });

    it('should return null if NaN after parsing', () => {
      expect(convertedMin(2)(new FormControl('a'))).toBeNull();
    });

    it('should return a validation error on small values', () => {
      expect(convertedMin(2)(new FormControl(1))).toEqual({
        'min': {
          'min': 2,
          'actual': 1,
        },
      });
    });

    it('should return a validation error on small values converted from strings', () => {
      expect(convertedMin(2)(new FormControl('1'))).toEqual({
        'min': {
          'min': 2,
          'actual': '1',
        },
      });
    });

    it('should not error on small float number validation', () => {
      expect(convertedMin(1.2)(new FormControl(1.25))).toBeNull();
    });

    it('should not error on equal float values', () => {
      expect(convertedMin(1.25)(new FormControl(1.25))).toBeNull();
    });

    it('should return a validation error on big values', () => {
      expect(convertedMin(1.25)(new FormControl(1.2))).toEqual({
        'min': {'min': 1.25, 'actual': 1.2},
      });
    });

    it('should not error on big values', () => {
      expect(convertedMin(2)(new FormControl(3))).toBeNull();
    });

    it('should not error on equal values', () => {
      expect(convertedMin(2)(new FormControl(2))).toBeNull();
    });

    it('should not error on equal values when value is string', () => {
      expect(convertedMin(2)(new FormControl('2'))).toBeNull();
    });

    it('should validate as expected when min value is a string', () => {
      expect(convertedMin('2' as any)(new FormControl(1))).toEqual({
        'min': {'min': '2', 'actual': 1},
      });
    });

    it('should return null if min value is undefined', () => {
      expect(convertedMin(undefined as any)(new FormControl(3))).toBeNull();
    });

    it('should return null if min value is null', () => {
      expect(convertedMin(null as any)(new FormControl(3))).toBeNull();
    });

    it('should react to changes', () => {
      const control = new FormControl(3, {validators: [convertedMin(5)]});
      expect(control.errors).toEqual({min: {min: 5, actual: 3}});
      control.setValue(12);
      expect(control.errors).toEqual(null);
      control.setValue(1);
      expect(control.errors).toEqual({min: {min: 5, actual: 1}});
    });
  });
});
