import {AbstractControl, FormControl, ValidatorFn} from '@angular/forms';
import {FieldPath, form, validate} from '@angular/forms/experimental';
import {inject, Injector, signal} from '@angular/core';

export function convertOldValidatorToNewOne(p: FieldPath<any>, validator: ValidatorFn) {
  const control = new FormControl(undefined, {validators: [validator]});
  validate(p, (ctx) => {
    control.setValue(ctx.value());
    if (ctx.state.dirty()) {
      control.markAsDirty();
    }
    const entries = Object.entries(control.errors || {});

    return entries.map(([kind]) => {
      return {
        kind: kind,
      };
    });
  });
}

export function importMinValidator(min: (path: FieldPath<any>, n: number) => any) {
  const injector = inject(Injector);
  return (n: number | string | null) => {
    if (n === null || n === undefined) {
      return () => null;
    }
    const minValue = parseFloat(n.toString());
    const model = signal(0);
    const f = form(model, (p) => min(p, minValue), {injector});

    return (c: AbstractControl) => {
      if (c.value === null || c.value === '') {
        return null;
      }
      model.set(c.value);

      const errors = f().errors();

      if (errors.length === 0) {
        return null;
      }

      return errors.reduce(
        (acc, error) => {
          acc[error.kind] = {min: n, actual: c.value};
          return acc;
        },
        {} as Record<string, any>,
      );
    };
  };
}
