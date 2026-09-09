// The three rules no built-in class-validator decorator expresses; everything else in a DTO is a
// stock decorator plus a `@Transform` where the old imperative validator also normalised input.
import { Transform } from 'class-transformer';
import {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

const isLocal = (h: string) =>
  h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');

/**
 * A pre-approved open redirect off our origin: non-http(s) schemes would allow
 * `javascript:`/`data:` redirect XSS, and https outside localhost stops a cleartext downgrade and
 * is required for App Links/Universal Links. Not `@IsUrl()`: no "https except localhost", no
 * embedded-credential check.
 */
@ValidatorConstraint({ name: 'isRedirectUrl' })
class RedirectUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (value === null) return true; // normaliseRedirectUrl maps absent/empty to null
    if (typeof value !== 'string') return false;
    let u: URL;
    try {
      u = new URL(value);
    } catch {
      return false;
    }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal(u.hostname))) return false;
    return !u.username && !u.password;
  }

  defaultMessage({ property }: ValidationArguments) {
    return `${property} must be an absolute https URL without embedded credentials (http allowed only for localhost)`;
  }
}

// Canonicalise before validating: the stored value has always been `new URL(x).toString()`, and
// dropping that would change the format of every URL written from here on.
const normaliseRedirectUrl = Transform(({ value }) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return value;
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
});

/** Validates and normalises a redirect URL. Absent or `''` becomes `null`, which clears the column. */
export function IsRedirectUrl(options?: ValidationOptions) {
  return (target: object, key: string) => {
    normaliseRedirectUrl(target, key);
    registerDecorator({
      target: target.constructor,
      propertyName: key,
      validator: RedirectUrlConstraint,
      options,
    });
  };
}

/**
 * bcrypt ignores everything past 72 bytes, so without a ceiling any string sharing a long
 * passphrase's first 72 bytes would log in. Bytes, not characters: `@MaxLength` counts UTF-16 code
 * units and one emoji is four bytes to bcrypt, so the wrong unit lets the truncation back in.
 */
@ValidatorConstraint({ name: 'maxByteLength' })
class MaxByteLengthConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, { constraints }: ValidationArguments) {
    return typeof value === 'string' && Buffer.byteLength(value) <= (constraints[0] as number);
  }

  defaultMessage({ property, constraints }: ValidationArguments) {
    return `${property} must be ${constraints[0]} bytes or fewer`;
  }
}

export function MaxByteLength(max: number, options?: ValidationOptions) {
  return (target: object, key: string) =>
    registerDecorator({
      target: target.constructor,
      propertyName: key,
      validator: MaxByteLengthConstraint,
      constraints: [max],
      options,
    });
}

// `type` is the key a campaign names its reward by, so a duplicate makes the offer ambiguous.
// Cross-element, so it cannot live on the element DTO.
@ValidatorConstraint({ name: 'uniqueBonusTypes' })
class UniqueBonusTypesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (!Array.isArray(value)) return true; // shape is @IsArray's problem, not ours
    const types = value.map((b) => b?.type).filter((t) => typeof t === 'string');
    return new Set(types).size === types.length;
  }

  defaultMessage() {
    return 'bonuses must hold one entry per kind — a type appears twice';
  }
}

export function HasUniqueBonusTypes(options?: ValidationOptions) {
  return (target: object, key: string) =>
    registerDecorator({
      target: target.constructor,
      propertyName: key,
      validator: UniqueBonusTypesConstraint,
      options,
    });
}
