<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1.0" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.1.0/StyledLayerDescriptor.xsd" xmlns:se="http://www.opengis.net/se">
 <NamedLayer>
  <se:Name>Vegetation_Zones</se:Name>
  <UserStyle>
   <se:Name>default</se:Name>
   <se:FeatureTypeStyle>
    <se:Rule>
     <se:Name>Mangrove</se:Name>
     <se:Description>
      <se:Title>Mangrove</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>vegetation_class</ogc:PropertyName>
       <ogc:Literal>Mangrove</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PolygonSymbolizer>
      <se:Fill>
       <se:SvgParameter name="fill">#005500</se:SvgParameter>
       <se:SvgParameter name="fill-opacity">0.65</se:SvgParameter>
      </se:Fill>
      <se:Stroke>
       <se:SvgParameter name="stroke">#003300</se:SvgParameter>
       <se:SvgParameter name="stroke-width">1</se:SvgParameter>
       <se:SvgParameter name="stroke-linejoin">round</se:SvgParameter>
      </se:Stroke>
     </se:PolygonSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Monsoon Woodland</se:Name>
     <se:Description>
      <se:Title>Monsoon Woodland</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>vegetation_class</ogc:PropertyName>
       <ogc:Literal>Monsoon Woodland</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PolygonSymbolizer>
      <se:Fill>
       <se:SvgParameter name="fill">#448844</se:SvgParameter>
       <se:SvgParameter name="fill-opacity">0.6</se:SvgParameter>
      </se:Fill>
      <se:Stroke>
       <se:SvgParameter name="stroke">#226622</se:SvgParameter>
       <se:SvgParameter name="stroke-width">1</se:SvgParameter>
       <se:SvgParameter name="stroke-linejoin">round</se:SvgParameter>
      </se:Stroke>
     </se:PolygonSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Savanna Grassland</se:Name>
     <se:Description>
      <se:Title>Savanna Grassland</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>vegetation_class</ogc:PropertyName>
       <ogc:Literal>Savanna Grassland</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PolygonSymbolizer>
      <se:Fill>
       <se:SvgParameter name="fill">#ccaa44</se:SvgParameter>
       <se:SvgParameter name="fill-opacity">0.55</se:SvgParameter>
      </se:Fill>
      <se:Stroke>
       <se:SvgParameter name="stroke">#997722</se:SvgParameter>
       <se:SvgParameter name="stroke-width">1</se:SvgParameter>
       <se:SvgParameter name="stroke-linejoin">round</se:SvgParameter>
      </se:Stroke>
     </se:PolygonSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Saltmarsh</se:Name>
     <se:Description>
      <se:Title>Saltmarsh</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>vegetation_class</ogc:PropertyName>
       <ogc:Literal>Saltmarsh</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PolygonSymbolizer>
      <se:Fill>
       <se:SvgParameter name="fill">#449999</se:SvgParameter>
       <se:SvgParameter name="fill-opacity">0.65</se:SvgParameter>
      </se:Fill>
      <se:Stroke>
       <se:SvgParameter name="stroke">#226666</se:SvgParameter>
       <se:SvgParameter name="stroke-width">1</se:SvgParameter>
       <se:SvgParameter name="stroke-linejoin">round</se:SvgParameter>
      </se:Stroke>
     </se:PolygonSymbolizer>
    </se:Rule>
   </se:FeatureTypeStyle>
  </UserStyle>
 </NamedLayer>
</StyledLayerDescriptor>
