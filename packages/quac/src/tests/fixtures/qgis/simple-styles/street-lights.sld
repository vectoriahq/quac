<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1.0" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.1.0/StyledLayerDescriptor.xsd" xmlns:se="http://www.opengis.net/se">
 <NamedLayer>
  <se:Name>Street_Lights</se:Name>
  <UserStyle>
   <se:Name>default</se:Name>
   <se:FeatureTypeStyle>
    <se:Rule>
     <se:Name>LED</se:Name>
     <se:Description>
      <se:Title>LED</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>lamp_type</ogc:PropertyName>
       <ogc:Literal>LED</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PointSymbolizer>
      <se:Graphic>
       <se:Mark>
        <se:WellKnownName>circle</se:WellKnownName>
        <se:Fill>
         <se:SvgParameter name="fill">#f5e642</se:SvgParameter>
        </se:Fill>
        <se:Stroke>
         <se:SvgParameter name="stroke">#333333</se:SvgParameter>
         <se:SvgParameter name="stroke-width">0.5</se:SvgParameter>
        </se:Stroke>
       </se:Mark>
       <se:Size>12</se:Size>
      </se:Graphic>
     </se:PointSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Sodium</se:Name>
     <se:Description>
      <se:Title>Sodium</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>lamp_type</ogc:PropertyName>
       <ogc:Literal>Sodium</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PointSymbolizer>
      <se:Graphic>
       <se:Mark>
        <se:WellKnownName>circle</se:WellKnownName>
        <se:Fill>
         <se:SvgParameter name="fill">#e8891a</se:SvgParameter>
        </se:Fill>
        <se:Stroke>
         <se:SvgParameter name="stroke">#333333</se:SvgParameter>
         <se:SvgParameter name="stroke-width">0.5</se:SvgParameter>
        </se:Stroke>
       </se:Mark>
       <se:Size>12</se:Size>
      </se:Graphic>
     </se:PointSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Metal Halide</se:Name>
     <se:Description>
      <se:Title>Metal Halide</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>lamp_type</ogc:PropertyName>
       <ogc:Literal>Metal Halide</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PointSymbolizer>
      <se:Graphic>
       <se:Mark>
        <se:WellKnownName>circle</se:WellKnownName>
        <se:Fill>
         <se:SvgParameter name="fill">#4287f5</se:SvgParameter>
        </se:Fill>
        <se:Stroke>
         <se:SvgParameter name="stroke">#333333</se:SvgParameter>
         <se:SvgParameter name="stroke-width">0.5</se:SvgParameter>
        </se:Stroke>
       </se:Mark>
       <se:Size>14</se:Size>
      </se:Graphic>
     </se:PointSymbolizer>
    </se:Rule>
   </se:FeatureTypeStyle>
  </UserStyle>
 </NamedLayer>
</StyledLayerDescriptor>
