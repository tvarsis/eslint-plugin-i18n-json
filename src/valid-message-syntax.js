/* eslint-disable global-require, import/no-dynamic-require */
const set = require('lodash.set');
const diff = require('jest-diff');
const isPlainObject = require('lodash.isplainobject');
const prettyFormat = require('pretty-format');
const icuValidator = require('./message-validators/icu');
const notEmpty = require('./message-validators/not-empty');
const deepForOwn = require('./util/deep-for-own');
const isString = require('./message-validators/is-string');

/* Error tokens */
const EMPTY_OBJECT = Symbol.for('EMPTY_OBJECT');
const ARRAY = Symbol.for('ARRAY');

/* Formatting */
const ALL_BACKSLASHES = /[\\]/g;
const ALL_DOUBLE_QUOTES = /["]/g;

const prettyFormatTypePlugin = {
  test(val) {
    return typeof val === 'number' || typeof val === 'string';
  },
  serialize(val) {
    return (typeof val === 'string' && `String(${`'${val}'`})`) || `Number(${val})`;
  },
};

const formatExpectedValue = ({ value }) => {
  switch (value) {
    case EMPTY_OBJECT:
    case ARRAY:
      return 'ObjectContaining<ValidMessages> | ValidMessage<String>';
    default:
      return 'ValidMessage<String>';
  }
};

const formatReceivedValue = ({ value, error }) => {
  const errorMessage = error.message
    .replace(ALL_BACKSLASHES, '')
    .replace(ALL_DOUBLE_QUOTES, '\'');
  switch (value) {
    case EMPTY_OBJECT:
      return `${prettyFormat({})} ===> ${error}`;
    case ARRAY:
      return `${prettyFormat([])} ===> ${error}`;
    default:
      return `${prettyFormat(value, {
        plugins: [prettyFormatTypePlugin],
      })} ===> ${errorMessage}`;
  }
};

const createValidator = (syntax) => {
  // each syntax type defined here must have a case!
  if (['icu', 'non-empty-string'].includes(syntax)) {
    return (value) => {
      switch (syntax) {
        case 'icu':
          notEmpty(value);
          isString(value);
          icuValidator(value);
          break;
        default:
          notEmpty(value);
          isString(value);
      }
    };
  }
  // custom validator
  const customValidator = require(syntax); // eslint-disable import/no-dynamic-require
  return (value, key) => {
    customValidator(value, key);
  };
};

const validMessageSyntax = ([options = {}], source) => {
  let {
    syntax,
  } = options;
  syntax = syntax && syntax.trim();

  let translations = null;
  const invalidMessages = [];

  if (!syntax) {
    return [{
      message: '"syntax" not specified in rule option.',
      loc: {
        start: {
          line: 0,
          col: 0,
        },
      },
    }];
  }

  try {
    translations = JSON.parse(source);
  } catch (e) {
    return [];
  }

  let validate;

  try {
    validate = createValidator(syntax);
  } catch (e) {
    return [{
      message: `Error configuring syntax validator. Rule option specified: ${syntax}. ${e}`,
      loc: {
        start: {
          line: 0,
          col: 0,
        },
      },
    }];
  }

  deepForOwn(translations, (value, key, path) => {
    // empty object itself is an error
    if (isPlainObject(value)) {
      if (Object.keys(value).length === 0) {
        invalidMessages.push({
          value: EMPTY_OBJECT, key, path, error: new SyntaxError('Empty object.'),
        });
      }
    } else if (Array.isArray(value)) {
      invalidMessages.push({
        value: ARRAY, key, path, error: new TypeError('An Array cannot be a translation value.'),
      });
    } else {
      try {
        validate(value, key);
      } catch (validationError) {
        invalidMessages.push({
          value, key, path, error: validationError,
        });
      }
    }
  });

  if (invalidMessages.length > 0) {
    const expected = {};
    const received = {};
    invalidMessages.forEach((invalidMessage) => {
      set(expected, invalidMessage.path, formatExpectedValue(invalidMessage));
      set(received, invalidMessage.path, formatReceivedValue(invalidMessage));
    });

    return [{
      message: `\n${diff(expected, received)}`,
      loc: {
        start: {
          line: 0,
          col: 0,
        },
      },
    }];
  }
  // no errors
  return [];
};

module.exports = {
  meta: {
    docs: {
      category: 'Validation',
      description: 'Validates message syntax for each translation key in the file.',
      recommended: true,
    },
    schema: [{
      properties: {
        syntax: {
          type: ['string'],
        },
      },
      type: 'object',
      additionalProperties: false,
    }],
  },
  create(context) {
    return {
      Program(node) {
        const {
          value: source,
        } = node.comments[0];
        const errors = validMessageSyntax(context.options, source);
        errors.forEach((error) => {
          context.report(error);
        });
      },
    };
  },
};
