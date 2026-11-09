<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1.0" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.1.0/StyledLayerDescriptor.xsd" xmlns:se="http://www.opengis.net/se">
 <NamedLayer>
  <se:Name>Building_Permits</se:Name>
  <UserStyle>
   <se:Name>default</se:Name>
   <se:FeatureTypeStyle>
    <se:Rule>
     <se:Name>Pending</se:Name>
     <se:Description>
      <se:Title>Pending</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>status</ogc:PropertyName>
       <ogc:Literal>Pending</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PolygonSymbolizer>
      <se:Fill>
       <se:SvgParameter name="fill">#ffee88</se:SvgParameter>
       <se:SvgParameter name="fill-opacity">0.6</se:SvgParameter>
      </se:Fill>
      <se:Stroke>
       <se:SvgParameter name="stroke">#ccbb00</se:SvgParameter>
       <se:SvgParameter name="stroke-width">1.5</se:SvgParameter>
       <se:SvgParameter name="stroke-linejoin">miter</se:SvgParameter>
      </se:Stroke>
     </se:PolygonSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Approved</se:Name>
     <se:Description>
      <se:Title>Approved</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>status</ogc:PropertyName>
       <ogc:Literal>Approved</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PolygonSymbolizer>
      <se:Fill>
       <se:SvgParameter name="fill">#88cc88</se:SvgParameter>
       <se:SvgParameter name="fill-opacity">0.6</se:SvgParameter>
      </se:Fill>
      <se:Stroke>
       <se:SvgParameter name="stroke">#449944</se:SvgParameter>
       <se:SvgParameter name="stroke-width">1.5</se:SvgParameter>
       <se:SvgParameter name="stroke-linejoin">miter</se:SvgParameter>
      </se:Stroke>
     </se:PolygonSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Expired</se:Name>
     <se:Description>
      <se:Title>Expired</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>status</ogc:PropertyName>
       <ogc:Literal>Expired</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PolygonSymbolizer>
      <se:Fill>
       <se:SvgParameter name="fill">#aaaaaa</se:SvgParameter>
       <se:SvgParameter name="fill-opacity">0.6</se:SvgParameter>
      </se:Fill>
      <se:Stroke>
       <se:SvgParameter name="stroke">#777777</se:SvgParameter>
       <se:SvgParameter name="stroke-width">1.5</se:SvgParameter>
       <se:SvgParameter name="stroke-linejoin">miter</se:SvgParameter>
      </se:Stroke>
     </se:PolygonSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Refused</se:Name>
     <se:Description>
      <se:Title>Refused</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>status</ogc:PropertyName>
       <ogc:Literal>Refused</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PolygonSymbolizer>
      <se:Fill>
       <se:SvgParameter name="fill">#cc8888</se:SvgParameter>
       <se:SvgParameter name="fill-opacity">0.6</se:SvgParameter>
      </se:Fill>
      <se:Stroke>
       <se:SvgParameter name="stroke">#993333</se:SvgParameter>
       <se:SvgParameter name="stroke-width">1.5</se:SvgParameter>
       <se:SvgParameter name="stroke-linejoin">miter</se:SvgParameter>
      </se:Stroke>
     </se:PolygonSymbolizer>
    </se:Rule>
   </se:FeatureTypeStyle>
  </UserStyle>
 </NamedLayer>
</StyledLayerDescriptor>
