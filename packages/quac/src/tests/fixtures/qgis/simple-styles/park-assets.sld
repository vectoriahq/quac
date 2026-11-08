<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1.0" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.1.0/StyledLayerDescriptor.xsd" xmlns:se="http://www.opengis.net/se">
 <NamedLayer>
  <se:Name>Park_Assets</se:Name>
  <UserStyle>
   <se:Name>default</se:Name>
   <se:FeatureTypeStyle>
    <se:Rule>
     <se:Name>Bench</se:Name>
     <se:Description>
      <se:Title>Bench</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>asset_type</ogc:PropertyName>
       <ogc:Literal>Bench</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PointSymbolizer>
      <se:Graphic>
       <se:Mark>
        <se:WellKnownName>square</se:WellKnownName>
        <se:Fill>
         <se:SvgParameter name="fill">#8b4513</se:SvgParameter>
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
     <se:Name>BBQ</se:Name>
     <se:Description>
      <se:Title>BBQ</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>asset_type</ogc:PropertyName>
       <ogc:Literal>BBQ</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PointSymbolizer>
      <se:Graphic>
       <se:Mark>
        <se:WellKnownName>square</se:WellKnownName>
        <se:Fill>
         <se:SvgParameter name="fill">#666666</se:SvgParameter>
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
     <se:Name>Playground</se:Name>
     <se:Description>
      <se:Title>Playground</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>asset_type</ogc:PropertyName>
       <ogc:Literal>Playground</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PointSymbolizer>
      <se:Graphic>
       <se:Mark>
        <se:WellKnownName>square</se:WellKnownName>
        <se:Fill>
         <se:SvgParameter name="fill">#cc0000</se:SvgParameter>
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
    <se:Rule>
     <se:Name>Drinking Fountain</se:Name>
     <se:Description>
      <se:Title>Drinking Fountain</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>asset_type</ogc:PropertyName>
       <ogc:Literal>Drinking Fountain</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PointSymbolizer>
      <se:Graphic>
       <se:Mark>
        <se:WellKnownName>square</se:WellKnownName>
        <se:Fill>
         <se:SvgParameter name="fill">#009999</se:SvgParameter>
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
     <se:Name>Shelter</se:Name>
     <se:Description>
      <se:Title>Shelter</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>asset_type</ogc:PropertyName>
       <ogc:Literal>Shelter</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:PointSymbolizer>
      <se:Graphic>
       <se:Mark>
        <se:WellKnownName>square</se:WellKnownName>
        <se:Fill>
         <se:SvgParameter name="fill">#336600</se:SvgParameter>
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
   </se:FeatureTypeStyle>
  </UserStyle>
 </NamedLayer>
</StyledLayerDescriptor>
