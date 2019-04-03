/*!
  Copyright 2018 Google LLC

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

  https://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/
import {
  ClearInteraction,
  ConfigData,
  ConfigDataElement,
  ConfigDataElementType,
  ConfigId,
  ConfigStyle,
  ConfigStyleElement,
  DSInteractionData,
  DSInteractionType,
  DSRowValue,
  Field,
  FieldId,
  FieldsByConfigId,
  FieldsById,
  Interaction,
  InteractionMessage,
  InteractionsById,
  InteractionType,
  Message,
  MessageType,
  ObjectRow,
  ObjectTables,
  ObjectTransform,
  ParsedImage,
  PostMessage,
  Row,
  RowHeading,
  SendInteraction,
  StyleById,
  SubscriptionsOptions,
  Table,
  TableFormat,
  Tables,
  TableTransform,
  TableType,
  ThemeStyle,
  ToDSMessageType,
  VizReadyMessage,
} from './types';

// Make all exported types available to external users.
export * from './types';

/**
 * Returns the width (in pixels) of the vis's iframe.
 *
 * Usage:
 * ```
 * var myWidth = dscc.getWidth();
 * console.log('My width is: ', myWidth);
 * ```
 */
export const getWidth = (): number => document.body.clientWidth;

/**
 * Returns the height (in pixels) of the vis's iframe.
 *
 * Usage:
 * ```
 * var myHeight = dscc.getHeight();
 * console.log('My height is: ', myHeight);
 * ```
 */
export const getHeight = (): number => document.documentElement.clientHeight;

/**
 * Returns the componentId of the vis. Component ids uniquely identify a vis to
 * Data Studio.
 *
 * Usage:
 * ```
 * var myComponentId = dscc.getComponentId();
 * console.log('My componentId is: ', myComponentId);
 * ```
 */
const getComponentId = (): string =>
  window.frameElement.getAttribute('componentid');

/**
 * Parses a `'\u00a0\u00a0'` delimited string into component parts. If any parts
 * are missing, they will be returned as undefined.
 *
 * Usage:
 * ```
 * const myImage = parseImage('originalurl.com\u00a0\u00a0proxiedurl.com\u00a0\u00a0alt text');
 *
 * expect(myImage).toEqual({
 *   originalUrl: 'originalurl.com',
 *   proxiedUrl: 'proxiedurl.com',
 *   altText: 'alt text',
 * });
 * ```
 */
export const parseImage = (value: string): ParsedImage => {
  const [originalUrl, proxiedUrl, altText] = value.split('\u00a0\u00a0');
  return {
    altText,
    originalUrl,
    proxiedUrl,
  };
};

/**
 * Returns the fields indexed by their Data Studio id.
 */
const fieldsById = (message: Message): FieldsById =>
  message.fields.reduce((acc: FieldsById, field: Field) => {
    acc[field.id] = field;
    return acc;
  }, {});

/**
 * Zips two arrays together into a new array. Uses the length of the shortest
 * array.
 *
 * Usage:
 * ```
 * const a = [1, 2, 3];
 * const b = ['a', 'b', 'c', 'd'];
 * const zipped = zip2(a, b);
 * expect(zipped).toEqual([[1, 'a'], [2, 'b'], [3, 'c']]);
 * ```
 */
const zip2 = <T, U>(t: T[], u: U[]): Array<[T, U]> => {
  if (t.length < u.length) {
    return t.map((tEntry: T, idx: number): [T, U] => [tEntry, u[idx]]);
  } else {
    return u.map((uEntry: U, idx: number): [T, U] => [t[idx], uEntry]);
  }
};

// `.sort` isn't stable, but if you compare items, and when they are equal use
// the original index, it is then stable.
const stableSort = <T>(arr: T[], compare: (a: T, b: T) => number): T[] =>
  arr
    .map((item, index) => ({item, index}))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map(({item}) => item);

const dimensionOrMetric = (cde: ConfigDataElement): boolean =>
  cde.type === ConfigDataElementType.DIMENSION ||
  cde.type === ConfigDataElementType.METRIC;

const toNum = (cdet: ConfigDataElementType) =>
  cdet === ConfigDataElementType.DIMENSION ? -1 : 1;

/**
 * Flattens the configIds from a message into a single array. The config Ids
 * will be repeated for the `METRIC`/`DIMENSION` selections. i.e. for a `METRIC`
 * named `"metrics"` of `{min: 2, max:3}`, the value metrics will be repeated 2
 * to 3 times depending on what values the user selects.
 *
 * Note: this is relying on the fact that the postMessage from DataStudio has
 * the fields sorted to be dimensions, followed by metrics.
 */
const flattenConfigIds = (message: Message): ConfigId[] => {
  const configDataElements: ConfigDataElement[] = [];
  message.config.data.forEach((configData: ConfigData) => {
    configData.elements.forEach((configDataElement: ConfigDataElement) => {
      configDataElements.push(configDataElement);
    });
  });
  const dimnsAndMets = configDataElements.filter(dimensionOrMetric);
  const sorted = stableSort(
    dimnsAndMets,
    (a, b) => toNum(a.type) - toNum(b.type)
  );
  const configIds: ConfigId[] = [];
  sorted.forEach((configDataElement: ConfigDataElement) => {
    configDataElement.value.forEach(() => configIds.push(configDataElement.id));
  });
  return configIds;
};

/**
 * Joins a single table row with the matching `ConfigId`
 */
const joinObjectRow = (configIds: ConfigId[]) => (row: Row): ObjectRow => {
  const objectRow: ObjectRow = {};

  zip2(row, configIds).forEach(([rowVal, configId]: [DSRowValue, ConfigId]) => {
    if (objectRow[configId] === undefined) {
      objectRow[configId] = [];
    }
    objectRow[configId].push(rowVal);
  }, {});

  return objectRow;
};

/**
 * Formats tables into the `ObjectTables` format.
 */
const objectFormatTable = (message: Message): ObjectTables => {
  const configIds = flattenConfigIds(message);
  const objectTables: ObjectTables = {[TableType.DEFAULT]: []};

  message.dataResponse.tables.forEach((table: Table) => {
    const objectRows: ObjectRow[] = table.rows.map(joinObjectRow(configIds));
    objectTables[table.id] = objectRows;
  });

  return objectTables;
};

/**
 * Formats tables into the `Tables` format.
 */
const tableFormatTable = (message: Message): Tables => {
  const fieldsBy: FieldsByConfigId = fieldsByConfigId(message);
  const configIds = flattenConfigIds(message);
  const configIdIdx = {};
  const headers: RowHeading[] = configIds.map(
    (configId: string): RowHeading => {
      if (configIdIdx[configId] === undefined) {
        configIdIdx[configId] = 0;
      } else {
        configIdIdx[configId]++;
      }
      const idx = configIdIdx[configId];
      const field = fieldsBy[configId][idx];
      const heading: RowHeading = {...field, configId};
      return heading;
    }
  );
  const tableTables: Tables = {
    [TableType.DEFAULT]: {headers: [], rows: []},
  };

  message.dataResponse.tables.forEach((table: Table) => {
    tableTables[table.id] = {
      headers,
      rows: table.rows,
    };
  });

  return tableTables;
};

/**
 * Returns the fields indexed by their config id. Since many fields can be in
 * the same `METRIC`/`DIMENSION` selection, `configId` is mapped to `Field[]`.
 */
export const fieldsByConfigId = (message: Message): FieldsByConfigId => {
  const fieldsByDSId = fieldsById(message);
  const fieldsBy: FieldsByConfigId = {};

  message.config.data.forEach((configData: ConfigData) => {
    configData.elements.forEach((configDataElement: ConfigDataElement) => {
      fieldsBy[configDataElement.id] = configDataElement.value.map(
        (dsId: FieldId): Field => fieldsByDSId[dsId]
      );
    });
  });

  return fieldsBy;
};

/**
 * Flattens the style entries into a single object. `styleId`s should be unique.
 */
const flattenStyle = (message: Message): StyleById => {
  const styleById: StyleById = {};
  (message.config.style || []).forEach((styleEntry: ConfigStyle) => {
    styleEntry.elements.forEach((configStyleElement: ConfigStyleElement) => {
      if (styleById[configStyleElement.id] !== undefined) {
        throw new Error(
          `styleIds must be unique. Your styleId: '${
            configStyleElement.id
          }' is used more than once.`
        );
      }
      styleById[configStyleElement.id] = {
        value: configStyleElement.value,
        defaultValue: configStyleElement.defaultValue,
      };
    });
  }, {});

  return styleById;
};

const themeStyle = (message: Message): ThemeStyle => {
  return message.config.themeStyle;
};

const mapInteractionTypes = (
  dsInteraction: DSInteractionType
): InteractionType => {
  switch (dsInteraction) {
    case DSInteractionType.FILTER:
      return InteractionType.FILTER;
  }
};

const transformDSInteraction = (message: Message): InteractionsById => {
  const dsInteractions: DSInteractionData[] = message.config.interactions;
  // TODO - remove once interactions are live.
  if (dsInteractions === undefined) {
    return {};
  }
  return dsInteractions.reduce(
    (acc: InteractionsById, dsInteraction: DSInteractionData) => {
      const interactions = dsInteraction.supportedActions.map(
        mapInteractionTypes
      );
      const value = mapInteractionTypes(dsInteraction.value);
      acc[dsInteraction.id] = {
        id: dsInteraction.id,
        value,
        interactions,
      };
      return acc;
    },
    {}
  );
};

/**
 * The transform to use for data in a Table format. i.e. `[[1, 2, 3], [4, 5, 6]]`
 */
export const tableTransform: TableTransform = (
  message: Message
): TableFormat => ({
  tables: tableFormatTable(message),
  fields: fieldsByConfigId(message),
  style: flattenStyle(message),
  theme: themeStyle(message),
  interactions: transformDSInteraction(message),
});

/**
 * The transform to use for data in an object format. i.e. `[{name: 'john', views: 3}, {name: 'suzie', views: 5}]`
 */
export const objectTransform: ObjectTransform = (message: Message) => ({
  tables: objectFormatTable(message),
  fields: fieldsByConfigId(message),
  style: flattenStyle(message),
  theme: themeStyle(message),
  interactions: transformDSInteraction(message),
});

/*
 * Subscribes to messages from Data Studio. Calls `cb` for every new
 * [[MessageType.RENDER]] message. Returns a function that will unsubscribe
 * `callback` from further invocations.
 *
 * Usage - tableTransform:
 * ```
 * var unsubscribe = dscc.subscribeToData(function(message) {
 *   console.log(message.tables)
 *   console.log(message.fields)
 *   console.log(message.style)
 * }, {transform: dscc.tableTransform});
 *
 * setTimeout(function() {
 *   unsubscribe();
 * }, 3000)
 * ```

 * Usage - objectTransform:
 * ```
 * var unsubscribe = dscc.subscribeToData(function(message) {
 *   console.log(message.tables)
 *   console.log(message.fields)
 *   console.log(message.style)
 * }, {transform: dscc.objectTransform});
 *
 * setTimeout(function() {
 *   unsubscribe();
 * }, 3000)
 * ```
 */
export const subscribeToData = <T>(
  cb: (componentData: T) => void,
  options: SubscriptionsOptions<T>
): (() => void) => {
  if (
    (options.transform as any) === tableTransform ||
    (options.transform as any) === objectTransform
  ) {
    const onMessage = (message: PostMessage) => {
      if (message.data.type === MessageType.RENDER) {
        cb(options.transform(message.data));
      } else {
        console.error(
          `MessageType: ${
            message.data.type
          } is not supported by this version of the library.`
        );
      }
    };
    window.addEventListener('message', onMessage);
    const componentId = getComponentId();
    // Tell DataStudio that the viz is ready to get events.
    const vizReadyMessage: VizReadyMessage = {
      componentId,
      type: ToDSMessageType.VIZ_READY,
    };
    window.parent.postMessage(vizReadyMessage, '*');
    return () => window.removeEventListener('message', onMessage);
  } else {
    throw new Error(`Only the built in transform functions are supported.`);
  }
};

/*
 * Does the thing that interactions should do.
 */
export const sendInteraction: SendInteraction = (
  actionId,
  interaction,
  data
) => {
  const interactionMessage: InteractionMessage = {
    type: ToDSMessageType.INTERACTION,
    componentId: getComponentId(),
    id: actionId,
    data,
  };
  window.parent.postMessage(interactionMessage, '*');
};

/*
 * Clears an interaction
 */

export const clearInteraction: ClearInteraction = (actionId, interaction) => {
  const interactionMessage: InteractionMessage = {
    type: ToDSMessageType.INTERACTION,
    componentId: getComponentId(),
    id: actionId,
    data: undefined,
  };
  window.parent.postMessage(interactionMessage, '*');
};
