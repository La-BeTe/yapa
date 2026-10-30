import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ADMIN_KEY_HEADER } from '../auth/admin-key.guard';

export const DOCS_PATH = 'docs';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('YAPA: YAPA Is Another Payment API')
    .setDescription(
      [
        'Multi-currency stablecoin wallet sandbox (cNGN, cGHS, cXAF, USDx, EURx).',
        '',
        'Conventions:',
        '- every response is an envelope `{ status, message, data }`;',
        '- amounts are integer strings in minor units (cXAF has 0 decimals, the others 2);',
        '- field names are snake_case;',
        '- `POST /transactions` is idempotent on `unique_reference`;',
        '- every response carries an `X-Request-Id` header.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: ADMIN_KEY_HEADER }, 'admin-key')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup(DOCS_PATH, app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: `${DOCS_PATH}/openapi.json`,
  });
}
