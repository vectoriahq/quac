/**
 * The package's public API: everything an application imports from
 * `@vectoriahq/quac`.
 */

export type {
  QgsProject,
  ProjectMetadata,
  MapExtent,
  BoundingBox,
  LayerEntry,
  EditLock,
  LayerLocks,
  LockedEdit,
  ProjectMeasurement,
  LayerStyle,
  LayerResourceMetadata,
  LayerScaleRange,
  LayerContact,
  LayerAttribution,
  FieldAttachment,
  FieldCheckbox,
  FieldConstraintExpression,
  FieldDefaultExpression,
  FieldDefaultValue,
  FieldEditRule,
  FormLayoutField,
  LayerFormLayout,
  FieldFixedValue,
  FieldRange,
  FieldUuidFormat,
  FieldValueMapEntry,
  DataSource,
  FileDataSource,
  WfsDataSource,
  WmsDataSource,
  UnsupportedDataSource,
  LayerTreeNode,
  LayerGroup,
  LayerTreeLeaf,
  QgsRelation,
  QgsRelationFieldPair
} from './model/QgsProject.ts'

export type {
  StacCatalog,
  StacCollection,
  StacItem,
  StacAsset,
  StacExtent,
  StacLink,
  StacObject,
  StacProvider,
  TableColumn,
  TableColumnType,
  TableColumnValue,
  TableColumnValueRelation,
  TableColumnAttachment,
  TableColumnCheckbox,
  TableColumnRange
} from './model/Stac.ts'
export { STAC_VERSION } from './model/Stac.ts'
export { isIconLibraryAddress, resolveFieldIconAddress } from './model/fieldIconAddress.ts'
export {
  collectCollectionStyles,
  getDefaultStyle,
  styleAssetKey,
  GL_STYLE_MEDIA_TYPE
} from './model/stacStyles.ts'
export type { StacStyle, StyleOverrideReference } from './model/stacStyles.ts'

export { parseQgsXml } from './parse/parseQgsXml.ts'
export { measureFactorsOf } from './parse/parseMeasurement.ts'
export type { MeasureFactors } from './parse/parseMeasurement.ts'
export { readProjectXml } from './parse/readProjectFile.ts'
export { collectLayerVisibility } from './parse/collectLayerVisibility.ts'
export { parseDataSource } from './parse/parseDataSource.ts'
export { findGeometrySiblings, readGeometrySiblingShapes, readSiblingShapes, siblingCollectionId } from './parse/geometrySiblings.ts'
export { qmlForLayer } from './generate/qmlForLayer.ts'
export {
  generateStacCatalogue,
  parseQgisStyleAssetHref,
  isQgisPlaceholderDescription,
  QUAC_GEOMETRY_FILTER,
  QUAC_LAYER_NAME,
  readCollectionGeometryFilter,
  readCollectionLayerName
} from './generate/stacCatalogue.ts'
export {
  DEFAULT_DELIMITED_TEXT_OPTIONS,
  QUAC_DELIMITED_TEXT,
  readCollectionDelimitedText
} from './model/delimitedText.ts'
export { QUAC_FEATURE_FILTER, readCollectionFeatureFilter } from './model/featureFilter.ts'
export type { FeatureFilter, FeatureFilterDialect } from './model/featureFilter.ts'
export type { DelimitedTextOptions } from './model/delimitedText.ts'
export {
  decodeAssetPath,
  encodeAssetPath,
  isRelativeHref,
  readCollectionDataPath,
  readCollectionOnlineFile
} from './model/stacHref.ts'
export {
  DATA_ROLE,
  findAssetByRole,
  readDataAsset
} from './model/stacAssetRoles.ts'
export {
  THUMBNAIL_ROLE,
  readCollectionAttribution,
  readCollectionDeprecation,
  readCollectionSelfHref,
  readCollectionThumbnail
} from './model/stacCollectionNotes.ts'
export {
  FILE_EXTENSION,
  FILE_SIZE_FIELD,
  TABLE_ROW_COUNT_FIELD,
  readCollectionRowCount,
  readDataAssetFileSize
} from './model/stacSizeAndCount.ts'
export {
  PMTILES_MEDIA_TYPE,
  VISUAL_ROLE,
  readCollectionPmtiles
} from './model/stacPmtiles.ts'
export type { StacPmtilesSource } from './model/stacPmtiles.ts'
export type { StacCompanionData } from './generate/stacCatalogue.ts'
export {
  QUAC_ACTIVE_COLLECTION_FIELD,
  QUAC_FILTERS_FIELD,
  QUAC_FORM_ORDER_FIELD,
  QUAC_LOCKS_FIELD,
  QUAC_MUTUALLY_EXCLUSIVE_FIELD,
  QUAC_PRIVATE_FIELD,
  readCatalogueActiveCollection,
  readCatalogueInitialView,
  readCollectionDisplayField,
  readCollectionEditable,
  readCollectionFieldAliases,
  readCollectionFieldAttachments,
  readCollectionFieldEditRules,
  readCollectionFieldNames,
  readCollectionFieldTypes,
  readCollectionFieldValueRelations,
  readCollectionFieldValues,
  readCollectionFormLayout,
  readCollectionGeometryType,
  readCollectionIdentifiable,
  readCollectionMeasurement,
  readCollectionOpacity,
  readCollectionIcon,
  readCollectionLegendImage,
  readCollectionFilters,
  readCollectionLocks,
  readCollectionPrivate,
  readCollectionRelatedTo,
  readCollectionScaleRange,
  readCollectionVisibility,
  statedOpacity
} from './generate/normalizedProject.ts'
export type { CollectionFilter, CollectionFormLayout, CollectionRelation, CollectionRelationField } from './generate/normalizedProject.ts'
export { generateStacCatalogueFromWfsCapabilities } from './generate/wfsStacCatalogue.ts'
export type { WfsStacCatalogueOptions } from './generate/wfsStacCatalogue.ts'
export { generateStacCatalogueFromFolder } from './generate/folderStacCatalogue.ts'
export type { FolderCatalogueFile, FolderStacCatalogueOptions } from './generate/folderStacCatalogue.ts'
export { generateCollectionForDroppedFile, generateCollectionForLinkedFile } from './generate/fileLayerCollection.ts'
export type { DroppedFileCollectionOptions, LinkedFileCollectionOptions } from './generate/fileLayerCollection.ts'
export {
  generateStacCatalogueFromOgcCollections,
  resolveOgcCollectionSource
} from './generate/ogcFeaturesStacCatalogue.ts'
export type {
  OgcCollectionSource,
  OgcFeaturesCollectionSource,
  OgcFeaturesStacCatalogueOptions,
  OgcTilesCollectionSource
} from './generate/ogcFeaturesStacCatalogue.ts'
export {
  generateStacCatalogueFromArcgisLayers,
  readArcgisCatalogueItemId,
  readArcgisNotShownReason,
  resolveArcgisCollectionSource
} from './generate/arcgisStacCatalogue.ts'
export type { ArcgisStacCatalogueOptions } from './generate/arcgisStacCatalogue.ts'
export {
  normalizeExternalStacCatalogue,
  parseWfsGetFeatureUrl,
  resolveWfsCollectionSource
} from './generate/externalStacCatalogue.ts'
export {
  decodeItemRowId,
  describeItem,
  encodeItemRowId,
  itemAsCollection,
  ITEMS_PAGE_SIZE,
  readItemsHref,
  readItemTimestamp,
  sortItemsNewestFirst
} from './sources/stacItems.ts'
export { stripQgisServerQuery } from './sources/qgisServerUrl.ts'

export type {
  WmsProject,
  WmsLayerTreeNode,
  WmsLayer,
  WmsLayerGroup,
  WmsBoundingBox,
  WmsStyle,
  WmsAttribute
} from './model/WmsProject.ts'
export { parseGetProjectSettings } from './parse/parseGetProjectSettings.ts'
export { generateStacCatalogueFromWms } from './generate/wmsStacCatalogue.ts'
export type { WmsStacCatalogueOptions } from './generate/wmsStacCatalogue.ts'
export { collectCatalogueCollections, listCatalogueChildren } from './model/stacTreeWalk.ts'
export type { CatalogueChild } from './model/stacTreeWalk.ts'

// Logging is off until the application using the package turns it on.
export { setDevLogging } from './util/devLog.ts'

// What an application imports by name, beside the exports above.
export type { ArcgisCodedValue, ArcgisExtent, ArcgisField, ArcgisFieldMetadata, ArcgisLayerSet, ArcgisLayerSource, ArcgisNotShownReason, ArcgisPassthrough, ArcgisRange, ArcgisResolution, ArcgisResolvedLayer } from './model/arcgis.ts'
export type { OgcCollection, OgcCollectionsDocument, OgcItemType, OgcLink } from './model/ogcFeatures.ts'
export { WEB_MAP_LINKS_EXTENSION, buildWmsLink, readCollectionWms, wmsEndpoint } from './model/stacWms.ts'
export type { StacWmsSource } from './model/stacWms.ts'
export { readCollectionWmts, wmtsCapabilitiesUrl } from './model/stacWmts.ts'
export type { StacWmtsSource } from './model/stacWmts.ts'
export { VECTOR_TILE_MEDIA_TYPE, buildXyzLink, readCollectionXyzLink, readCollectionXyzTemplate } from './model/stacXyz.ts'
export type { ActiveWfsLayer, WfsCapabilities, WfsDescribeFeatureTypeSchema, WfsFeatureTypeOperationsSupport, WfsFeatureTypeSummary, WfsFieldKind, WfsFieldSchema, WfsOperationName, WfsTransactionOperation, WfsTransactionResult, WfsValidationError, WfsWgs84BoundingBox } from './model/wfs.ts'
export { parseProjectMeasurement } from './parse/parseMeasurement.ts'
export { GEOMETRY_VALUES, LAYER_LOOKUP, QGIS_CONDITION, expressionToGeoStylerFunction, expressionToTemplate, isQgisConditionFilter, qgisConditionToFilter, readCurrentValueFields, readLayerLookups, readQgisExpression } from './parse/qgisExpression.ts'
export type { ExpressionNode, LayerLookup } from './parse/qgisExpression.ts'
export { formatQtDateTime, qtDatePart, readQtDateTime, splitQtDatePattern } from './parse/qtDateFormat.ts'
export { compileQtRegex, replaceQtRegex } from './parse/qtRegex.ts'
export { cloneCatalogShallow, collectAllCollections, resolveDocumentHrefs, withSelfLink } from './sources/stacDocuments.ts'
export { buildItemUrl, buildItemsPageUrl, readItem, readItemsPage } from './sources/stacItems.ts'
export type { StacItemsPage } from './sources/stacItems.ts'
export { CATALOGUE_FILE_FORMATS, COG_MEDIA_TYPE, CSV_MEDIA_TYPE, declaredMediaTypeForFile, FLATGEOBUF_MEDIA_TYPE, GEOJSON_MEDIA_TYPE, GEOPACKAGE_MEDIA_TYPE, hasRole, isLayerFileOfFormat, PARQUET_MEDIA_TYPE, PROJECT_DATA_ROLES, QML_STYLE_MEDIA_TYPE } from './util/catalogueFileFormats.ts'
export type { CatalogueFileFormat, LayerFileFormatId, LayerFileRole, RoleFilter } from './util/catalogueFileFormats.ts'
export { devLog } from './util/devLog.ts'
export { getFileNameFromPath, getLowerCaseExtension, getNormalisedFileBasename, getParentFolderPath } from './util/fileName.ts'
export { DEFAULT_WFS_VERSION, SPOKEN_WFS_VERSIONS, WFS_CAPABILITIES_VERSION, WFS_FALLBACK_VERSION } from './util/wfsVersions.ts'
export { QUAC_SCHEMA_URL, declareQuacExtension, isNewerQuacMajor, listQuacExtension, readQuacVersion } from './model/quacExtension.ts'
export { generateServerStacCatalogue } from './generate/serverStacCatalogue.ts'
export { serverLayerTree } from './generate/serverLayerTree.ts'
export type { ServerLayerTree, ServerLayerTreeGroup, ServerLayerTreeLayer, ServerLayerTreeNode } from './generate/serverLayerTree.ts'
