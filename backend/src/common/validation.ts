/**
 * The three rules no built-in class-validator decorator expresses. Everything else in a DTO is a
 * stock decorator — `@IsString`, `@MaxLength`, `@Matches`, `@NotContains('\0')` — paired with a
 * `@Transform` where the old imperative validator also normalised its input.
 */
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
 * A publisher-registered URL a scan can be redirected to. It carries no token, but it is still an
 * open redirect off our origin, so it is pre-approved rather than free text: rejecting non-http(s)
 * schemes kills `javascript:`/`data:` redirect XSS, and https outside localhost stops a scan being
 * downgraded to cleartext — and is what makes App Links and Universal Links work at all.
 *
 * Not `@IsUrl()`: that has no way to say "https, except http on localhost" or to reject embedded
 * credentials, and both of those are the point.
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

/**
 * Canonicalise before validating, because the stored value is `new URL(x).toString()` and always
 * was — dropping that would silently change the format of every URL written from here on.
 * Unparseable input is passed through untouched for the constraint to reject.
 */
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
 * bcrypt silently ignores everything past 72 bytes, so without a ceiling a 200-character
 * passphrase is only ever its first 72 bytes — and any other string sharing that prefix would log
 * in. Rejecting is honest; truncating is a trap.
 *
 * Bytes, not characters: `@MaxLength` counts UTF-16 code units, and one emoji is four bytes to
 * bcrypt. A limit in the wrong unit lets the truncation back in.
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

/**
 * `type` is the key a campaign names its reward by, so it has to identify one offer. Two entries
 * sharing a slug make "this campaign advertises `coins`" ambiguous. A cross-element rule, so it
 * cannot live on the element DTO.
 */
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
