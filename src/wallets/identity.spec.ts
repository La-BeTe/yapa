import { AppError } from '../common/http/app-error';
import { normaliseIdentity } from './identity';

describe('normaliseIdentity', () => {
  it('lower-cases and trims emails', () => {
    expect(normaliseIdentity({ email: '  Ada@Example.COM ' })).toEqual({
      email: 'ada@example.com',
    });
  });

  it('normalises phone numbers to E.164', () => {
    expect(normaliseIdentity({ phone: '+234 803 123 4567' })).toEqual({ phone: '+2348031234567' });
    expect(normaliseIdentity({ phone: '+233-24-123-4567' })).toEqual({ phone: '+233241234567' });
  });

  it('keeps both identifiers when given', () => {
    expect(normaliseIdentity({ email: 'a@b.co', phone: '+2348031234567' })).toEqual({
      email: 'a@b.co',
      phone: '+2348031234567',
    });
  });

  it.each([{}, { email: '  ' }, { phone: '' }])('requires an identifier (%p)', (input) => {
    expect(() => normaliseIdentity(input)).toThrow(AppError);
  });

  it.each(['08031234567', '+999123', 'abc'])('rejects invalid phone %p', (phone) => {
    expect(() => normaliseIdentity({ phone })).toThrow(/valid international number/);
  });
});
