/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ValidationErrors} from '@angular/forms';
import {createError, ValidationError} from '../../api/validation_errors';

export function reactiveErrorsToSignalErrors(errors: ValidationErrors | null) {
  if (errors === null) {
    return [];
  }

  return Object.entries(errors).map(([kind, context]) => {
    return createError(ReactiveValidationError, undefined, {context, kind});
  });
}

/**
 * An error used to indicate that a value is not a valid email.
 */
export class ReactiveValidationError extends ValidationError {
  override readonly kind: string = 'reactive';
  context: any;

  constructor({context, kind}: {context: any; kind: string}) {
    super();
    this.context = context;
    this.kind = kind;
  }
}
