/**
 * Public API of the qgs/ package.
 *
 * It is designed to be reused as a server-side STAC-endpoint generator in the
 * future, and any app dependencies would block that. It imports no app file,
 * and only the packages listed in `qgsPackageImports` in eslint.config.js,
 * which ESLint enforces.
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
} from './model/QgsProject'

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
} from './model/Stac'
export { STAC_VERSION } from './model/Stac'
export { isIconLibraryAddress, resolveFieldIconAddress } from './model/fieldIconAddress'
export {
  collectCollectionStyles,
  getDefaultStyle,
  styleAssetKey,
  GL_STYLE_MEDIA_TYPE
} from './model/stacStyles'
export type { StacStyle, StyleOverrideReference } from './model/stacStyles'

export { parseQgsXml } from './parse/parseQgsXml'
export { measureFactorsOf } from './parse/parseMeasurement'
export type { MeasureFactors } from './parse/parseMeasurement'
export { readProjectXml } from './parse/readProjectFile'
export { collectLayerVisibility } from './parse/collectLayerVisibility'
export { parseDataSource } from './parse/parseDataSource'
export { findGeometrySiblings, readGeometrySiblingShapes, readSiblingShapes, siblingCollectionId } from './parse/geometrySiblings'
export { qmlForLayer } from './generate/qmlForLayer'
export {
  generateStacCatalogue,
  parseQgisStyleAssetHref,
  isQgisPlaceholderDescription,
  QUAC_GEOMETRY_FILTER,
  QUAC_LAYER_NAME,
  readCollectionGeometryFilter,
  readCollectionLayerName
} from './generate/stacCatalogue'
export {
  DEFAULT_DELIMITED_TEXT_OPTIONS,
  QUAC_DELIMITED_TEXT,
  readCollectionDelimitedText
} from './model/delimitedText'
export { QUAC_FEATURE_FILTER, readCollectionFeatureFilter } from './model/featureFilter'
export type { FeatureFilter, FeatureFilterDialect } from './model/featureFilter'
export type { DelimitedTextOptions } from './model/delimitedText'
export {
  decodeAssetPath,
  encodeAssetPath,
  isRelativeHref,
  readCollectionDataPath,
  readCollectionOnlineFile
} from './model/stacHref'
export {
  DATA_ROLE,
  findAssetByRole,
  readDataAsset
} from './model/stacAssetRoles'
export {
  THUMBNAIL_ROLE,
  readCollectionAttribution,
  readCollectionDeprecation,
  readCollectionSelfHref,
  readCollectionThumbnail
} from './model/stacCollectionNotes'
export {
  FILE_EXTENSION,
  FILE_SIZE_FIELD,
  TABLE_ROW_COUNT_FIELD,
  readCollectionRowCount,
  readDataAssetFileSize
} from './model/stacSizeAndCount'
export {
  PMTILES_MEDIA_TYPE,
  VISUAL_ROLE,
  readCollectionPmtiles
} from './model/stacPmtiles'
export type { StacPmtilesSource } from './model/stacPmtiles'
export type { StacCompanionData } from './generate/stacCatalogue'
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
} from './generate/normalizedProject'
export type { CollectionFilter, CollectionFormLayout, CollectionRelation, CollectionRelationField } from './generate/normalizedProject'
export { generateStacCatalogueFromWfsCapabilities } from './generate/wfsStacCatalogue'
export type { WfsStacCatalogueOptions } from './generate/wfsStacCatalogue'
export { generateStacCatalogueFromFolder } from './generate/folderStacCatalogue'
export type { FolderCatalogueFile, FolderStacCatalogueOptions } from './generate/folderStacCatalogue'
export { generateCollectionForDroppedFile, generateCollectionForLinkedFile } from './generate/fileLayerCollection'
export type { DroppedFileCollectionOptions, LinkedFileCollectionOptions } from './generate/fileLayerCollection'
export {
  generateStacCatalogueFromOgcCollections,
  resolveOgcCollectionSource
} from './generate/ogcFeaturesStacCatalogue'
export type {
  OgcCollectionSource,
  OgcFeaturesCollectionSource,
  OgcFeaturesStacCatalogueOptions,
  OgcTilesCollectionSource
} from './generate/ogcFeaturesStacCatalogue'
export {
  generateStacCatalogueFromArcgisLayers,
  readArcgisCatalogueItemId,
  readArcgisNotShownReason,
  resolveArcgisCollectionSource
} from './generate/arcgisStacCatalogue'
export type { ArcgisStacCatalogueOptions } from './generate/arcgisStacCatalogue'
export {
  normalizeExternalStacCatalogue,
  parseWfsGetFeatureUrl,
  resolveWfsCollectionSource
} from './generate/externalStacCatalogue'
export {
  decodeItemRowId,
  describeItem,
  encodeItemRowId,
  itemAsCollection,
  ITEMS_PAGE_SIZE,
  readItemsHref,
  readItemTimestamp,
  sortItemsNewestFirst
} from './sources/stacItems'
export { stripQgisServerQuery } from './sources/qgisServerUrl'

export type {
  WmsProject,
  WmsLayerTreeNode,
  WmsLayer,
  WmsLayerGroup,
  WmsBoundingBox,
  WmsStyle,
  WmsAttribute
} from './model/WmsProject'
export { parseGetProjectSettings } from './parse/parseGetProjectSettings'
export { generateStacCatalogueFromWms } from './generate/wmsStacCatalogue'
export type { WmsStacCatalogueOptions } from './generate/wmsStacCatalogue'
export { collectCatalogueCollections, listCatalogueChildren } from './model/stacTreeWalk'
export type { CatalogueChild } from './model/stacTreeWalk'

// Logging is off until the application using the package turns it on.
export { setDevLogging } from './util/devLog'

// What Groundwork imports by name, beside the exports above. One entry point
// for now; the layered entry points come before package 5 publishes
// (docs/plans/quac-separation.md).
export type { ArcgisCodedValue, ArcgisExtent, ArcgisField, ArcgisFieldMetadata, ArcgisLayerSet, ArcgisLayerSource, ArcgisNotShownReason, ArcgisPassthrough, ArcgisRange, ArcgisResolution, ArcgisResolvedLayer } from './model/arcgis'
export type { OgcCollection, OgcCollectionsDocument, OgcItemType, OgcLink } from './model/ogcFeatures'
export { WEB_MAP_LINKS_EXTENSION, buildWmsLink, readCollectionWms, wmsEndpoint } from './model/stacWms'
export type { StacWmsSource } from './model/stacWms'
export { readCollectionWmts, wmtsCapabilitiesUrl } from './model/stacWmts'
export type { StacWmtsSource } from './model/stacWmts'
export { VECTOR_TILE_MEDIA_TYPE, buildXyzLink, readCollectionXyzLink, readCollectionXyzTemplate } from './model/stacXyz'
export type { ActiveWfsLayer, WfsCapabilities, WfsDescribeFeatureTypeSchema, WfsFeatureTypeOperationsSupport, WfsFeatureTypeSummary, WfsFieldKind, WfsFieldSchema, WfsOperationName, WfsTransactionOperation, WfsTransactionResult, WfsValidationError, WfsWgs84BoundingBox } from './model/wfs'
export { parseProjectMeasurement } from './parse/parseMeasurement'
export { GEOMETRY_VALUES, LAYER_LOOKUP, QGIS_CONDITION, expressionToGeoStylerFunction, expressionToTemplate, isQgisConditionFilter, qgisConditionToFilter, readCurrentValueFields, readLayerLookups, readQgisExpression } from './parse/qgisExpression'
export type { ExpressionNode, LayerLookup } from './parse/qgisExpression'
export { formatQtDateTime, qtDatePart, readQtDateTime, splitQtDatePattern } from './parse/qtDateFormat'
export { compileQtRegex, replaceQtRegex } from './parse/qtRegex'
export { cloneCatalogShallow, collectAllCollections, resolveDocumentHrefs, withSelfLink } from './sources/stacDocuments'
export { buildItemUrl, buildItemsPageUrl, readItem, readItemsPage } from './sources/stacItems'
export type { StacItemsPage } from './sources/stacItems'
export { CATALOGUE_FILE_FORMATS, COG_MEDIA_TYPE, CSV_MEDIA_TYPE, declaredMediaTypeForFile, FLATGEOBUF_MEDIA_TYPE, GEOJSON_MEDIA_TYPE, GEOPACKAGE_MEDIA_TYPE, hasRole, isLayerFileOfFormat, PARQUET_MEDIA_TYPE, PROJECT_DATA_ROLES, QML_STYLE_MEDIA_TYPE } from './util/catalogueFileFormats'
export type { CatalogueFileFormat, LayerFileFormatId, LayerFileRole, RoleFilter } from './util/catalogueFileFormats'
export { devLog } from './util/devLog'
export { getFileNameFromPath, getLowerCaseExtension, getNormalisedFileBasename, getParentFolderPath } from './util/fileName'
export { DEFAULT_WFS_VERSION, SPOKEN_WFS_VERSIONS, WFS_CAPABILITIES_VERSION, WFS_FALLBACK_VERSION } from './util/wfsVersions'
export { QUAC_SCHEMA_URL, declareQuacExtension, isNewerQuacMajor, listQuacExtension, readQuacVersion } from './model/quacExtension'
export { generateServerStacCatalogue } from './generate/serverStacCatalogue'
export { serverLayerTree } from './generate/serverLayerTree'
export type { ServerLayerTree, ServerLayerTreeGroup, ServerLayerTreeLayer, ServerLayerTreeNode } from './generate/serverLayerTree'
